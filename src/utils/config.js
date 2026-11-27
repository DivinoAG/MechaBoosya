'use strict';

// The effective configuration: the numbers the modules loaded at startup, reported verbatim rather
// than re-read from the environment, so the file cannot drift from the behaviour.

const { RANKING_LIMITS } = require('./ranking');
const { ANNOUNCE_AFTER_MINUTE } = require('./birthday');

function effectiveConfig() {
    return {
        ...RANKING_LIMITS,
        announceMinuteOfDay: ANNOUNCE_AFTER_MINUTE,
    };
}

module.exports = { effectiveConfig };
