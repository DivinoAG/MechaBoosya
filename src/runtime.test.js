'use strict';

// The bot's dispatch path: command loading, routing, failure replies, drain refusal.
// index.js wires these to discord.js; the logic itself must be testable without a gateway.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadCommands, createDispatcher } = require('./runtime');

function tempCommandsDir(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecha-cmds-'));
    for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);
    return dir;
}

function fakeLog() {
    const lines = [];
    return {
        lines,
        log: (...a) => lines.push(a.join(' ')),
        warn: (...a) => lines.push(a.join(' ')),
        error: (...a) => lines.push(a.join(' ')),
    };
}

function commandInteraction(name, { replied = false, deferred = false } = {}) {
    const replies = [];
    return {
        replies,
        commandName: name,
        user: { id: 'u1' },
        guildId: 'g1',
        channelId: 'c1',
        replied, deferred,
        isChatInputCommand: () => true,
        isButton: () => false,
        reply: async p => { replies.push(['reply', p]); },
        followUp: async p => { replies.push(['followUp', p]); },
    };
}

test('loader skips files without data.name and ignores test files', () => {
    const dir = tempCommandsDir({
        'good.js': "module.exports = { data: { name: 'good' }, execute() {} };",
        'also-good.js': "module.exports = { data: { name: 'also' }, execute() {} };",
        'broken.js': 'module.exports = { execute() {} };',
        'notacommand.test.js': "throw new Error('must not be loaded');",
    });

    const { commands, skipped } = loadCommands(dir);

    assert.deepStrictEqual([...commands.keys()].sort(), ['also', 'good']);
    assert.deepStrictEqual(skipped, ['broken.js']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('a command runs and the active count returns to zero', async () => {
    let ran = 0;
    const { commands } = loadCommands(tempCommandsDir({
        'a.js': 'module.exports = { data: { name: "a" }, execute() {} };',
    }));
    commands.get('a').execute = async () => { ran += 1; };

    const dispatcher = createDispatcher({ commands, store: {}, log: fakeLog() });
    await dispatcher.handle(commandInteraction('a'));

    assert.strictEqual(ran, 1);
    assert.strictEqual(dispatcher.activeCount, 0);
});

test('an unknown command is logged, not thrown', async () => {
    const log = fakeLog();
    const dispatcher = createDispatcher({ commands: new Map(), store: {}, log });

    await dispatcher.handle(commandInteraction('nope'));

    assert.ok(log.lines.some(l => /no handler registered/.test(l)));
    assert.strictEqual(dispatcher.activeCount, 0);
});

test('a throwing command replies with the generic error and does not escape', async () => {
    const log = fakeLog();
    const { commands } = loadCommands(tempCommandsDir({
        'boom.js': 'module.exports = { data: { name: "boom" }, execute() { throw new Error("kaput"); } };',
    }));

    const dispatcher = createDispatcher({ commands, store: {}, log });
    const interaction = commandInteraction('boom');
    await dispatcher.handle(interaction);

    assert.strictEqual(interaction.replies.length, 1);
    assert.strictEqual(interaction.replies[0][0], 'reply');
    assert.match(interaction.replies[0][1].content, /error while executing/i);
    assert.ok(log.lines.some(l => /FAILED after/.test(l)));
    assert.strictEqual(dispatcher.activeCount, 0);
});

test('a command that already replied gets a followUp, not a second reply', async () => {
    const { commands } = loadCommands(tempCommandsDir({
        'boom.js': 'module.exports = { data: { name: "boom" }, execute() { throw new Error("kaput"); } };',
    }));

    const dispatcher = createDispatcher({ commands, store: {}, log: fakeLog() });
    const interaction = commandInteraction('boom', { replied: true });
    await dispatcher.handle(interaction);

    assert.strictEqual(interaction.replies[0][0], 'followUp');
});

test('while draining, commands are refused with a retry message', async () => {
    let ran = 0;
    const { commands } = loadCommands(tempCommandsDir({
        'a.js': 'module.exports = { data: { name: "a" }, execute() {} };',
    }));
    commands.get('a').execute = async () => { ran += 1; };

    const dispatcher = createDispatcher({ commands, store: {}, log: fakeLog() });
    dispatcher.startDraining();

    const interaction = commandInteraction('a');
    await dispatcher.handle(interaction);

    assert.strictEqual(ran, 0, 'nothing runs once draining');
    assert.match(interaction.replies[0][1].content, /Restarting/);
});

test('the active count covers the whole execution, for the drain to wait on', async () => {
    const { commands } = loadCommands(tempCommandsDir({
        'slow.js': 'module.exports = { data: { name: "slow" }, execute() {} };',
    }));

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    commands.get('slow').execute = async () => { await gate; };

    const dispatcher = createDispatcher({ commands, store: {}, log: fakeLog() });
    const running = dispatcher.handle(commandInteraction('slow'));

    assert.strictEqual(dispatcher.activeCount, 1, 'counted while in flight');
    release();
    await running;
    assert.strictEqual(dispatcher.activeCount, 0);
});

test('list buttons are routed to the pager, and a pager failure is contained', async () => {
    const seen = [];
    const dispatcher = createDispatcher({
        commands: new Map(),
        store: {},
        log: fakeLog(),
        listButton: async (interaction, _store) => { seen.push(interaction.customId); throw new Error('page gone'); },
    });

    const button = {
        customId: 'blist:2',
        isButton: () => true,
        isChatInputCommand: () => false,
        guildId: 'g1',
    };

    await dispatcher.handle(button);
    assert.deepStrictEqual(seen, ['blist:2']);
});

test('interactions that are neither commands nor our buttons are ignored', async () => {
    const dispatcher = createDispatcher({ commands: new Map(), store: {}, log: fakeLog() });
    await dispatcher.handle({ isButton: () => false, isChatInputCommand: () => false });
    assert.strictEqual(dispatcher.activeCount, 0);
});

test('the command log names the user, not just the id', async () => {
    const log = fakeLog();
    const { commands } = loadCommands(tempCommandsDir({
        'a.js': 'module.exports = { data: { name: "a" }, execute() {} };',
    }));

    const dispatcher = createDispatcher({ commands, store: {}, log });
    const interaction = commandInteraction('a');
    interaction.user = { id: 'u1', username: 'kemwer' };
    await dispatcher.handle(interaction);

    assert.ok(log.lines.some(l => l.includes('user=u1(kemwer)')), `got: ${log.lines.join(' | ')}`);
});
