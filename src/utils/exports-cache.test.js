'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeRankingExport, findFreshExport } = require('./exports');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-cache-'));
}

function ageFile(file, minutes) {
    const t = new Date(Date.now() - minutes * 60_000);
    fs.utimesSync(file, t, t);
    return file;
}

const TTL = 3 * 3_600_000;

test('returns the newest fresh export for the channel', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;

    const file = writeRankingExport('42', [{ name: 'A', reactionCount: 3, tags: [] }]);
    const hit = findFreshExport('42', TTL, { dir });

    assert.ok(hit);
    assert.strictEqual(hit.file, file);
    assert.strictEqual(hit.payload.threads[0].name, 'A');
    assert.ok(hit.ageMs < 5_000);
});

test('returns null when the newest export is older than the ttl', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;
    ageFile(writeRankingExport('42', [{ name: 'A', reactionCount: 1, tags: [] }]), 200);

    assert.strictEqual(findFreshExport('42', TTL, { dir }), null);
});

test('ignores exports belonging to another channel', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;
    writeRankingExport('42', [{ name: 'A', reactionCount: 1, tags: [] }]);

    assert.strictEqual(findFreshExport('99', TTL, { dir }), null);
});

test('a malformed newest file degrades to a rescan instead of throwing', () => {
    const dir = tmpDir();
    process.env.EXPORT_DIR = dir;
    const file = writeRankingExport('42', [{ name: 'A', reactionCount: 1, tags: [] }]);
    fs.writeFileSync(file, '{ not json');

    assert.strictEqual(findFreshExport('42', TTL, { dir }), null);
});

test('missing directory means no cache', () => {
    assert.strictEqual(findFreshExport('42', TTL, { dir: path.join(os.tmpdir(), 'absent-dir-xyz') }), null);
});
