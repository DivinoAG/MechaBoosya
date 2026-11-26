'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeRankingExport, pruneExports, rankingPath } = require('./exports');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-exports-'));
}

const threads = [
    { name: 'A', reactionCount: 9, tags: ['elf'] },
    { name: 'B', reactionCount: 3, tags: [] },
];

test('writes a timestamped file with metadata and no leftover tmp', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;

    const file = writeRankingExport('123', threads, { channelName: 'cosplay' });
    const name = path.basename(file);

    assert.match(name, /^ranking-123-\d{4}-\d{2}-\d{2}T[\d-]+\.\d{3}Z\.json$/);
    assert.ok(fs.existsSync(file));
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);

    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(payload.channelId, '123');
    assert.strictEqual(payload.channelName, 'cosplay');
    assert.strictEqual(payload.count, 2);
    assert.deepStrictEqual(payload.threads, threads);
    assert.ok(!Number.isNaN(Date.parse(payload.generatedAt)));
});

test('two exports in the same second get distinct names', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;
    const seen = new Set();
    for (let i = 0; i < 5; i++) seen.add(rankingPath('9', new Date(2026, 0, 1, 0, 0, 0, i)));
    assert.strictEqual(seen.size, 5);
});

test('prunes only stale ranking files and db snapshots', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;
    const old = (name, days) => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, '{}');
        const t = new Date(Date.now() - days * 86_400_000);
        fs.utimesSync(p, t, t);
        return p;
    };

    const staleRanking = old('ranking-1-2020.json', 40);
    const freshRanking = old('ranking-1-2026.json', 1);
    const staleDb = old('db-2020.sqlite', 10);
    const freshDb = old('db-2026.sqlite', 2);
    const unrelated = old('notes.txt', 400);

    const removed = pruneExports({ dir });

    assert.deepStrictEqual(removed.sort(), [path.basename(staleDb), path.basename(staleRanking)].sort());
    assert.ok(fs.existsSync(freshRanking));
    assert.ok(fs.existsSync(freshDb));
    assert.ok(fs.existsSync(unrelated));
});

test('pruning a missing directory is a no-op', () => {
    assert.deepStrictEqual(pruneExports({ dir: path.join(os.tmpdir(), 'definitely-missing-dir-xyz') }), []);
});
