'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { formatLine, writeLine, logFile } = require('./logger');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-log-'));
}

test('lines carry an ISO timestamp and the level', () => {
    const line = formatLine('ERROR', ['boom', { detail: 1 }]);
    assert.match(line, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ERROR boom \{ detail: 1 \}$/);
});

test('writes appends into LOG_DIR', () => {
    const dir = tmpDir();
    process.env.LOG_DIR = dir;
    writeLine('first', 'test');
    writeLine('second', 'test');
    const content = fs.readFileSync(logFile('test'), 'utf8');
    assert.match(content, /^first\nsecond\n$/);
});

test('rotates when the file passes the size limit', () => {
    const dir = tmpDir();
    process.env.LOG_DIR = dir;
    process.env.LOG_MAX_BYTES = '200';
    process.env.LOG_KEEP = '2';

    for (let i = 0; i < 12; i++) writeLine(`${i} ${'x'.repeat(60)}`, 'rot');

    const file = logFile('rot');
    assert.ok(fs.existsSync(`${file}.1`), 'a rotated file must exist');
    // Rotation happens before the append, so the live file can exceed the limit by one line.
    assert.ok(fs.statSync(file).size < 200 + 100, 'live file stays near the limit');
    assert.ok(!fs.existsSync(`${file}.3`), 'rotation respects LOG_KEEP');
});

test('an unwritable directory is ignored instead of throwing', () => {
    process.env.LOG_DIR = '/proc/definitely-not-writable';
    assert.doesNotThrow(() => writeLine('nope', 'test'));
});
