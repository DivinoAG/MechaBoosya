'use strict';

// One scan per channel at a time: a second caller joins the running scan, renders the same
// progress and receives the same result instead of doubling the API traffic.

function createScanCoordinator() {
    const scans = new Map();

    return {
        join(channelId, start) {
            const existing = scans.get(channelId);
            if (existing) return { state: existing, joined: true };

            let release;
            const whenSettled = new Promise(resolve => { release = resolve; });
            const state = {
                progress: { done: 0, total: 0, startedAt: Date.now() },
                settled: false,
                whenSettled,
            };

            state.promise = Promise.resolve()
                .then(() => start(state.progress))
                .finally(() => {
                    state.settled = true;
                    release();
                    scans.delete(channelId);
                });
            // A joiner may never await it, and the starter reports its own failure.
            state.promise.catch(() => {});

            scans.set(channelId, state);
            return { state, joined: false };
        },

        get active() { return scans.size; },
    };
}

// Renders shared progress for one interaction until the scan settles. `format` returning null
// skips the edit, which is how small scans stay quiet.
async function renderProgress({
    interaction, state, format,
    intervalMs = 5_000,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
    while (!state.settled) {
        await Promise.race([sleep(intervalMs), state.whenSettled]);
        if (state.settled) break;

        const content = format(state.progress, Date.now() - state.progress.startedAt);
        if (content === null) continue;

        try {
            await interaction.editReply({ content });
        } catch {
            // A failed progress edit must not stop the scan.
        }
    }
}

module.exports = { createScanCoordinator, renderProgress };
