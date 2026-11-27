'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

// Logs land inside the exports volume so the gateway (read-only mount) can read them too.
function logDir() {
    return process.env.LOG_DIR || path.join(process.env.EXPORT_DIR || '/data/exports', 'logs');
}

function logFile(name = 'bot') {
    return path.join(logDir(), `${name}.log`);
}

function maxBytes() {
    return Number(process.env.LOG_MAX_BYTES || 5_000_000);
}

function keepFiles() {
    return Number(process.env.LOG_KEEP || 3);
}

function formatLine(level, args) {
    let body;
    try {
        body = util.format(...args);
    } catch {
        body = args.map(a => String(a)).join(' ');
    }
    return `${new Date().toISOString()} ${level.padEnd(5)} ${body}`;
}

function rotateIfNeeded(file) {
    try {
        if (fs.statSync(file).size < maxBytes()) return;
    } catch {
        return; // no file yet
    }
    const keep = keepFiles();
    for (let i = keep; i >= 1; i--) {
        const from = i === 1 ? file : `${file}.${i - 1}`;
        const to = `${file}.${i}`;
        try {
            if (i === keep) fs.rmSync(to, { force: true });
            fs.renameSync(from, to);
        } catch {
            // missing source: nothing to rotate
        }
    }
}

// Never throws: logging must not be able to take the bot down.
function writeLine(line, name = 'bot') {
    try {
        fs.mkdirSync(logDir(), { recursive: true });
        const file = logFile(name);
        rotateIfNeeded(file);
        fs.appendFileSync(file, `${line}\n`);
    } catch {
        // disk problem: console output still exists
    }
}

// Mirrors console output to the file, keeping the original console behaviour intact.
function install({ name = 'bot' } = {}) {
    const levels = { log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' };

    for (const [method, level] of Object.entries(levels)) {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            writeLine(formatLine(level, args), name);
            original(...args);
        };
    }

    process.on('unhandledRejection', reason => {
        console.error('[process] unhandled rejection:', reason);
    });

    process.on('uncaughtException', error => {
        console.error('[process] uncaught exception:', error);
        // Let the supervisor restart a process whose state is unknown.
        setTimeout(() => process.exit(1), 100).unref();
    });

    writeLine(formatLine('INFO', [`logger installed, writing to ${logFile(name)}`]), name);
    return { file: logFile(name) };
}

module.exports = { install, writeLine, formatLine, logFile, logDir };
