'use strict';

// Owns the bot process: crash recovery, heartbeat watchdog, deploy transaction, /health.
// Must stay dependency-free (node: builtins only) — it runs before node_modules exists.

const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const logger = require('./utils/logger');
logger.install({ name: 'supervisor' });
const { timingSafeEqual } = require('node:crypto');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_DIR = process.env.REPO_DIR || '/data/repo';
const ENTRY = process.env.ENTRY || 'src/index.js';
const PORT = Number(process.env.DEPLOY_PORT || 3000);
const SECRET = process.env.DEPLOY_SECRET || '';
const RUN_DIR = process.env.RUN_DIR || '/data/run';
const HEARTBEAT = process.env.HEARTBEAT_PATH || path.join(RUN_DIR, 'child.heartbeat');
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'origin/main';
const HEARTBEAT_STALE_MS = Number(process.env.HEARTBEAT_STALE_MS || 90_000);
const DRAIN_MS = Number(process.env.DRAIN_MS || 60_000);
const RESTART_DELAY_MS = Number(process.env.RESTART_DELAY_MS || 3_000);
const LOCK_STALE_MS = 180_000;

const DEPS_STAMP = path.join(RUN_DIR, 'deps.sha');

let child = null;
let childStartedAt = 0;
let lastRestartAt = null;
let crashCount = 0;
let stopping = false;
let heartbeatSeen = false;
let deployLock = null;

fs.mkdirSync(RUN_DIR, { recursive: true });

function git(...args) {
  const r = spawnSync('git', ['-C', REPO_DIR, ...args], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim()}`);
  return (r.stdout || '').trim();
}

function headCommit() {
  try { return git('rev-parse', '--short', 'HEAD'); } catch { return null; }
}

function startChild() {
  stopping = false;
  heartbeatSeen = false;
  childStartedAt = Date.now();

  const proc = spawn(process.execPath, [ENTRY], { cwd: REPO_DIR, env: process.env, stdio: 'inherit' });
  child = proc;

  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    if (stopping) return;
    crashCount += 1;
    lastRestartAt = new Date().toISOString();
    console.error(`[supervisor] child exited (code=${code} signal=${signal}), restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(() => { if (!child && !stopping) startChild(); }, RESTART_DELAY_MS);
  });
}

function stopChild(drain) {
  return new Promise(resolve => {
    if (!child) return resolve();
    const proc = child;
    stopping = true;
    const killTimer = setTimeout(() => { if (child === proc) proc.kill('SIGKILL'); }, drain ? DRAIN_MS : 0);
    proc.once('exit', () => { clearTimeout(killTimer); resolve(); });
    proc.kill('SIGTERM');
  });
}

// npm ci deletes node_modules before installing; move the old tree aside so a failed install is recoverable.
function installDeps({ force }) {
  const lockPath = path.join(REPO_DIR, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return false;

  const sha = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
  const nm = path.join(REPO_DIR, 'node_modules');
  const old = path.join(REPO_DIR, 'node_modules.old');
  const hasStamp = fs.existsSync(DEPS_STAMP) && fs.readFileSync(DEPS_STAMP, 'utf8').trim() === sha;
  if (!force && hasStamp && fs.existsSync(nm)) return false;

  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(nm)) fs.renameSync(nm, old);

  console.log('[supervisor] installing dependencies');
  const r = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: REPO_DIR, stdio: 'inherit', timeout: 600_000,
  });

  if (r.status !== 0) {
    fs.rmSync(nm, { recursive: true, force: true });
    if (fs.existsSync(old)) fs.renameSync(old, nm);
    throw new Error('npm ci failed');
  }

  fs.rmSync(old, { recursive: true, force: true });
  fs.writeFileSync(DEPS_STAMP, sha);
  return true;
}

function syntaxCheck() {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(path.join(REPO_DIR, 'src'));

  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`syntax error in ${path.relative(REPO_DIR, f)}: ${(r.stderr || '').trim()}`);
  }
  return files.length;
}

async function deploy() {
  let prevCommit = null;
  let npmCiRan = false;

  try {
    prevCommit = git('rev-parse', 'HEAD');
    git('fetch', 'origin', 'main');
    await stopChild(true);
    git('reset', '--hard', DEPLOY_BRANCH);
    npmCiRan = installDeps({ force: false });
    const checked = syntaxCheck();
    startChild();
    console.log(`[supervisor] deployed ${headCommit()} (prev ${prevCommit.slice(0, 7)}, ${checked} files checked)`);
    return { ok: true, commit: headCommit(), prevCommit: prevCommit.slice(0, 7), npmCiRan };
  } catch (err) {
    const short = prevCommit ? prevCommit.slice(0, 7) : 'unknown';
    console.error(`[supervisor] deploy failed: ${err.message} — rolling back to ${short}`);
    if (prevCommit) {
      try {
        git('reset', '--hard', prevCommit);
        installDeps({ force: true });
      } catch (rollbackErr) {
        console.error(`[supervisor] rollback incomplete: ${rollbackErr.message}`);
      }
    }
    stopping = false;
    if (!child) startChild();
    return { ok: false, error: err.message, commit: headCommit(), rolledBackTo: prevCommit ? prevCommit.slice(0, 7) : null };
  }
}

function secretMatches(header) {
  if (!SECRET) return false;
  const got = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}

function health() {
  return {
    status: 'ok',
    childState: child ? 'running' : 'stopped',
    pid: child ? child.pid : null,
    uptimeSec: Math.round((Date.now() - childStartedAt) / 1000),
    commit: headCommit(),
    lastRestartAt,
    crashCount,
    deploying: Boolean(deployLock),
  };
}

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') return send(200, health());

  if (req.method === 'POST' && req.url === '/deploy') {
    if (!secretMatches(req.headers.authorization)) return send(401, { ok: false, error: 'unauthorized' });

    if (deployLock && Date.now() - deployLock < LOCK_STALE_MS) return send(409, { ok: false, error: 'deploy in progress' });
    deployLock = Date.now();

    deploy()
      .then(result => send(result.ok ? 200 : 500, result))
      .catch(err => send(500, { ok: false, error: err.message }))
      .finally(() => { deployLock = null; });
    return;
  }

  send(404, { ok: false, error: 'not found' });
});

// Watchdog: restart a child that stopped touching its heartbeat. Ignored until the child writes one,
// so a bot build that predates the heartbeat cannot cause a restart loop.
setInterval(() => {
  if (!child || !heartbeatSeen) return;
  try {
    const age = Date.now() - fs.statSync(HEARTBEAT).mtimeMs;
    if (age > HEARTBEAT_STALE_MS) {
      console.error(`[supervisor] heartbeat stale for ${Math.round(age / 1000)}s, restarting child`);
      crashCount += 1;
      lastRestartAt = new Date().toISOString();
      child.kill('SIGKILL');
    } else {
      heartbeatSeen = true;
    }
  } catch {
    // missing heartbeat: nothing to judge yet
  }
}, 15_000).unref();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`[supervisor] ${sig}, draining child`);
    await stopChild(false);
    process.exit(0);
  });
}

try {
  installDeps({ force: false });
} catch (err) {
  console.error(`[supervisor] dependency install failed at boot: ${err.message}`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[supervisor] listening on :${PORT}, repo ${REPO_DIR} at ${headCommit()}`);
  startChild();
});
