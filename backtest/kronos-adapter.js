'use strict';

// Historical research consumes the same dependency-free path evaluator and
// response normalizer that the browser uses.  The official model invocation
// remains in tools/kronos_worker.py; this module deliberately does not create
// a second forecasting implementation.
const Kronos = require('../kronos-client');
const { createKronosWorker } = require('../server/kronos-worker');

function evaluateHistoricalKronosForecast(rawForecast, candidate, options = {}) {
    return Kronos.compactForPacket(Kronos.summarizeForecast(rawForecast, candidate, options));
}

function createHistoricalKronosAdapter({ env = process.env } = {}) {
    const worker = createKronosWorker({ env });
    return {
        requestForecast: payload => worker.request(payload),
        evaluateForecast: evaluateHistoricalKronosForecast,
        close: () => worker.stop()
    };
}

module.exports = { ...Kronos, evaluateHistoricalKronosForecast, createHistoricalKronosAdapter };
