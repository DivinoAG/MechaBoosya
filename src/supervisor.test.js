'use strict';

// Integration test for the deploy transaction: a throwaway git repo, a throwaway bare origin,
// and the supervisor as a real child process. No Discord, no container.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const SUPERVISOR = path.join(__dirname, 'supervisor.js');
const SECRET = 'test-secret';

function git(cwd, ...args) {
    return execFileSync('git', args, {
        cwd, encoding: 'utf8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
            GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
        },
    }).trim();
}

const STUB = `const fs = require('node:fs');
const path = require('node:path');
const beat = process.env.HEARTBEAT_PATH;
setInterval(() => {
    try { fs.mkdirSync(path.dirname(beat), { recursive: true }); const d = new Date(); fs.utimesSync(beat, d, d); }
    catch { try { fs.writeFileSync(beat, '1'); } catch {} }
}, 1000);
console.log('stub running');
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));
`;

function makeRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-sup-'));
    const repo = path.join(root, 'repo');
    const origin = path.join(root, 'origin.git');
    const run = path.join(root, 'run');

    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'stub.js'), STUB);

    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'initial');
    execFileSync('git', ['init', '-q', '--bare', origin]);
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    // The bare repo defaults to master; point it at main so clones check out the tree.
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: origin });

    return { root, repo, origin, run };
}

// A second working copy, the way a real deploy arrives: someone else commits and pushes.
function makeDevClone({ root, origin }) {
    const dev = path.join(root, 'dev');
    execFileSync('git', ['clone', '-q', origin, dev]);
    return dev;
}

async function waitFor(check, { timeoutMs = 20_000, everyMs = 200 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const value = await check();
            if (value) return value;
        } catch {
            // not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, everyMs));
    }
    throw new Error('timed out waiting for condition');
}

async function start({ repo, run, port }) {
    const child = spawn(process.execPath, [SUPERVISOR], {
        cwd: repo,
        env: {
            ...process.env,
            REPO_DIR: repo,
            RUN_DIR: run,
            HEARTBEAT_PATH: path.join(run, 'child.heartbeat'),
            ENTRY: 'src/stub.js',
            DEPLOY_PORT: String(port),
            DEPLOY_SECRET: SECRET,
            DRAIN_MS: '3000',
            HEARTBEAT_STALE_MS: '60000',
            LOG_DIR: run,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logs = [];
    child.stdout.on('data', d => logs.push(String(d)));
    child.stderr.on('data', d => logs.push(String(d)));

    const base = `http://127.0.0.1:${port}`;
    const health = async () => (await fetch(`${base}/health`)).json();
    await waitFor(async () => (await health()).childState === 'running');

    return { child, logs, base, health };
}

test('supervisor: deploy transaction, auth and rollback', { timeout: 90_000 }, async () => {
    const setup = makeRepo();
    const { root, repo, run } = setup;
    const dev = makeDevClone(setup);
    const port = 41_000 + Math.floor(Math.random() * 2_000);
    const sup = await start({ repo, run, port });

    try {
        const booted = await sup.health();
        assert.strictEqual(booted.childState, 'running');
        const firstCommit = booted.commit;

        const unauth = await fetch(`${sup.base}/deploy`, { method: 'POST' });
        assert.strictEqual(unauth.status, 401, 'no token is rejected');

        const ok = await fetch(`${sup.base}/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${SECRET}` },
        }).then(r => r.json());
        assert.strictEqual(ok.ok, true);
        assert.strictEqual(ok.commit, firstCommit);

        // Commit a file that does not compile from the developer clone and push it.
        fs.writeFileSync(path.join(dev, 'src', 'broken.js'), 'function ( {');
        git(dev, 'add', '-A');
        git(dev, 'commit', '-q', '-m', 'broken');
        git(dev, 'push', '-q', 'origin', 'main');

        const failed = await fetch(`${sup.base}/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${SECRET}` },
        }).then(r => r.json());

        assert.strictEqual(failed.ok, false, 'a syntax error fails the deploy');
        assert.match(failed.error, /syntax error/i);
        assert.strictEqual(failed.rolledBackTo, firstCommit, 'rolls back to the previous commit');

        const after = await sup.health();
        assert.strictEqual(after.childState, 'running', 'the old child keeps serving');
        assert.strictEqual(after.commit, firstCommit, 'the tree is back on the good commit');
        assert.ok(!fs.existsSync(path.join(repo, 'src', 'broken.js')), 'the broken file is not left behind');
    } finally {
        sup.child.kill('SIGTERM');
        await new Promise(resolve => sup.child.once('exit', resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('supervisor: a dead child is restarted and counted', { timeout: 60_000 }, async () => {
    const { root, repo, run } = makeRepo();
    const port = 43_000 + Math.floor(Math.random() * 2_000);
    const sup = await start({ repo, run, port });

    try {
        const before = await sup.health();
        process.kill(before.pid, 'SIGKILL');

        const recovered = await waitFor(async () => {
            const now = await sup.health();
            return now.childState === 'running' && now.pid !== before.pid ? now : null;
        });

        assert.strictEqual(recovered.childState, 'running');
        assert.ok(recovered.crashCount >= 1, 'the crash is counted');
    } finally {
        sup.child.kill('SIGTERM');
        await new Promise(resolve => sup.child.once('exit', resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
