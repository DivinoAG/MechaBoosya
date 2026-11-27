'use strict';

// Test-only: modules log straight to the console, so a green run is buried in
// "[list] page 1/1 rebuilt", "[birthday] announced …" and similar. Filter exactly those
// prefixes and let anything unexpected through — a swallowed error would hide a failure.

const CHATTER = /^\[(list|birthday|monthly|supervisor|cmd|log|rest|client)\]|^(Serving cached|Fetching forum|Found \d+ threads|Fetched a batch|Processing thread|Ranking export|Pruned |Failed to write ranking export)/;

function quietConsole() {
    for (const method of ['log', 'warn', 'error']) {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            if (typeof args[0] === 'string' && CHATTER.test(args[0])) return;
            original(...args);
        };
    }
}

module.exports = { quietConsole };
