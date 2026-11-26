'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { generateReportString } = require('./report-generator');

const rows = [
    { name: 'Alpha', reactionCount: 12, tags: ['elf', 'armor'] },
    { name: 'Beta', reactionCount: 4, tags: [] },
];

test('numbers entries from the chunk offset', () => {
    const out = generateReportString(rows, 50);
    assert.match(out, /^\*\*51\) Alpha\*\*/m);
    assert.match(out, /^\*\*52\) Beta\*\*/m);
});

test('prints votes and only lists tags when present', () => {
    const out = generateReportString(rows);
    assert.match(out, /Votes: 12/);
    assert.match(out, /Tags: elf, armor/);
    const beta = out.slice(out.indexOf('Beta'));
    assert.doesNotMatch(beta, /Tags:/);
});

test('separates entries with a blank line', () => {
    assert.strictEqual(generateReportString(rows).split('\n\n').length, 2);
});

test('handles an empty list', () => {
    assert.strictEqual(generateReportString([]), 'No threads found or processed.');
    assert.strictEqual(generateReportString(null), 'No threads found or processed.');
});
