'use strict';

// Documentation drift is invisible until someone trusts it: the README once documented a LOG_LEVEL
// that no code read. This compares the two directions — every variable the source reads is in the
// configuration table, and every variable the table names is read somewhere.

require('./test-support/quiet-console').quietConsole();

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

// Only these are exempt: a test-only switch, and nothing else may be.
const TEST_ONLY = new Set(['STUB_HEARTBEAT_ONCE']);

function sourceFiles(dir = SRC) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) out.push(full);
    }
    return out;
}

function variablesReadInSource() {
    const found = new Set();
    for (const file of sourceFiles()) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
            found.add(match[1]);
        }
    }
    return found;
}

function variablesInReadmeTable() {
    const found = new Set();
    for (const line of README.split('\n')) {
        if (!line.startsWith('|')) continue;
        // Only the first column names variables; the default column holds values like `UTC`.
        const nameCell = line.split('|')[1] ?? '';
        for (const match of nameCell.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)) found.add(match[1]);
    }
    return found;
}

test('every variable the source reads is documented', () => {
    const documented = variablesInReadmeTable();
    const missing = [...variablesReadInSource()].filter(name => !TEST_ONLY.has(name) && !documented.has(name));

    assert.deepStrictEqual(missing, [], `README is missing: ${missing.join(', ')}`);
});

test('every variable the table names is actually read', () => {
    const read = variablesReadInSource();
    const phantom = [...variablesInReadmeTable()].filter(name => !read.has(name));

    assert.deepStrictEqual(phantom, [], `README documents variables no code reads: ${phantom.join(', ')}`);
});
