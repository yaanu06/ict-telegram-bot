'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createMcpHandler, McpServer } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { z } = require('zod');

const GHOST_RESOURCE_URI = 'ict://ghost/specification';
const GHOST_RESOURCE_NAME = 'ICT Ghost Trading Specification';
const GHOST_INTERVALS = Object.freeze(['1day', '4h', '1h', '15min', '5min']);

const SERVER_INSTRUCTIONS = [
    'ICT Ghost provides a read-only methodology resource and current TVKit market-data tools.',
    `Read ${GHOST_RESOURCE_URI} before performing Ghost analysis.`,
    'Ghost semantic analysis uses exactly 1D, 4H, 1H, 15M, and 5M, represented by 1day, 4h, 1h, 15min, and 5min.',
    'Never invent missing market data. Return DATA_UNAVAILABLE when required data cannot be retrieved or validated.',
    'Return NO_TRADE or the appropriate Ghost WAIT state when data is valid but no opportunity passes the specification.',
    'AI interpretation cannot override the deterministic evidence and execution rules in the Ghost specification.',
    'This server is read-only and has no order, broker, credential, filesystem, shell, or arbitrary HTTP tools.'
].join(' ');

function normalizeGhostSymbol(value) {
    const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'XAU/USD' || normalized === 'XAUUSD' || normalized === 'OANDA:XAUUSD') return 'OANDA:XAUUSD';
    return normalized;
}

function toolResult(payload, isError = false) {
    return {
        ...(isError ? { isError: true } : {}),
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload
    };
}

function toolError(result) {
    const payload = result?.error && typeof result.error === 'object'
        ? result.error
        : { error_code: 'UPSTREAM_ERROR', message: 'Market data request failed' };
    return toolResult(payload, true);
}

function successOrError(result) {
    return result?.ok === false ? toolError(result) : toolResult(result.payload);
}

function createGhostMcpNodeHandler({
    ghostSpecPath = path.resolve(__dirname, '..', 'ghost', 'ICT_GHOST.md'),
    getQuote,
    getTimeSeries
} = {}) {
    if (typeof getQuote !== 'function' || typeof getTimeSeries !== 'function') {
        throw new TypeError('Ghost MCP market-data callbacks are required');
    }
    const specification = fs.readFileSync(ghostSpecPath, 'utf8');

    const handler = createMcpHandler(() => {
        const server = new McpServer(
            { name: 'ICT Ghost', version: '1.0.0' },
            { instructions: SERVER_INSTRUCTIONS }
        );

        server.registerResource(
            GHOST_RESOURCE_NAME,
            GHOST_RESOURCE_URI,
            {
                title: GHOST_RESOURCE_NAME,
                description: 'The authoritative AI-readable ICT Ghost methodology and output contract.',
                mimeType: 'text/markdown'
            },
            async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: specification }] })
        );

        server.registerTool(
            'get_quote',
            {
                title: 'Get current quote',
                description: 'Read the current quote for a symbol from the existing TVKit market-data path.',
                inputSchema: z.object({ symbol: z.string().min(1).max(32) })
            },
            async ({ symbol }) => successOrError(await getQuote({ symbol: normalizeGhostSymbol(symbol) }))
        );

        server.registerTool(
            'get_time_series',
            {
                title: 'Get closed-candle history',
                description: 'Read closed-candle history from the existing TVKit path. Ghost intervals are limited to 1day, 4h, 1h, 15min, and 5min.',
                inputSchema: z.object({
                    symbol: z.string().min(1).max(32),
                    interval: z.enum(GHOST_INTERVALS),
                    outputsize: z.number().int().min(20).max(5000).default(200)
                })
            },
            async ({ symbol, interval, outputsize = 200 }) => successOrError(await getTimeSeries({
                symbol: normalizeGhostSymbol(symbol),
                interval,
                outputsize
            }))
        );

        server.registerTool(
            'get_market_snapshot',
            {
                title: 'Get Ghost market snapshot',
                description: 'Read the current quote and the five Ghost semantic timeframes from the existing TVKit path. This tool does not analyze or rank trades.',
                inputSchema: z.object({ symbol: z.string().min(1).max(32) })
            },
            async ({ symbol }) => {
                const normalizedSymbol = normalizeGhostSymbol(symbol);
                const quote = await getQuote({ symbol: normalizedSymbol });
                if (quote?.ok === false) return toolError(quote);
                const timeSeries = {};
                for (const interval of GHOST_INTERVALS) {
                    const result = await getTimeSeries({ symbol: normalizedSymbol, interval, outputsize: 200 });
                    if (result?.ok === false) {
                        return toolError({
                            ok: false,
                            error: {
                                error_code: 'MARKET_DATA_UNAVAILABLE',
                                message: 'The complete Ghost market snapshot could not be retrieved.',
                                failed_interval: interval,
                                failed_request: result.error || null
                            }
                        });
                    }
                    timeSeries[interval] = result.payload;
                }
                return toolResult({
                    symbol: normalizedSymbol,
                    provider: 'TVKIT',
                    outputsize: 200,
                    quote: quote.payload,
                    time_series: timeSeries
                });
            }
        );

        return server;
    }, {
        legacy: 'stateless',
        responseMode: 'auto',
        onerror: () => {}
    });

    return toNodeHandler(handler, { maxRequestBodySize: 4 * 1024 * 1024 });
}

module.exports = {
    GHOST_INTERVALS,
    GHOST_RESOURCE_NAME,
    GHOST_RESOURCE_URI,
    SERVER_INSTRUCTIONS,
    normalizeGhostSymbol,
    createGhostMcpNodeHandler
};
