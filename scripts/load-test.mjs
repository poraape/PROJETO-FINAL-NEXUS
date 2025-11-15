#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const baseUrl = process.env.LOADTEST_BASE_URL || 'http://localhost:3001';
const durationMs = Number(process.env.LOADTEST_DURATION_MS || 15000);
const concurrency = Number(process.env.LOADTEST_CONCURRENCY || 8);
const paths = (process.env.LOADTEST_ENDPOINTS || '/api/health,/metrics,/api/observability/overview')
    .split(',')
    .map(path => path.trim())
    .filter(Boolean);

const stats = {
    baseUrl,
    durationMs,
    concurrency,
    startedAt: new Date().toISOString(),
    totals: {
        requests: 0,
        successes: 0,
        failures: 0,
    },
    perPath: paths.reduce((acc, path) => {
        acc[path] = { requests: 0, successes: 0, failures: 0, durations: [] };
        return acc;
    }, {}),
};

function pickNextPath(index) {
    const normalized = index % paths.length;
    return paths[normalized];
}

async function workerLoop(id, endTime) {
    let counter = 0;
    while (Date.now() < endTime) {
        const path = pickNextPath(counter);
        const url = new URL(path, baseUrl);
        const start = performance.now();
        try {
            const response = await fetch(url, { method: 'GET' });
            const duration = performance.now() - start;
            stats.totals.requests += 1;
            stats.perPath[path].requests += 1;
            stats.perPath[path].durations.push(duration);
            if (response.ok) {
                stats.totals.successes += 1;
                stats.perPath[path].successes += 1;
            } else {
                stats.totals.failures += 1;
                stats.perPath[path].failures += 1;
            }
        } catch (error) {
            stats.totals.requests += 1;
            stats.totals.failures += 1;
            stats.perPath[path].requests += 1;
            stats.perPath[path].failures += 1;
            stats.perPath[path].durations.push(performance.now() - start);
        }
        counter += 1;
    }
}

function summarizeDurations(durationList) {
    if (durationList.length === 0) return { avgMs: 0, p95Ms: 0, p99Ms: 0 };
    const sorted = durationList.slice().sort((a, b) => a - b);
    const percentile = (p) => {
        if (sorted.length === 0) return 0;
        const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
        return sorted[index];
    };
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    return {
        avgMs: sum / sorted.length,
        p95Ms: percentile(95),
        p99Ms: percentile(99),
    };
}

async function run() {
    const endTime = Date.now() + durationMs;
    await Promise.all(Array.from({ length: concurrency }, (_, index) => workerLoop(index, endTime)));
    stats.finishedAt = new Date().toISOString();
    const perPathSummary = {};
    Object.entries(stats.perPath).forEach(([path, pathStats]) => {
        perPathSummary[path] = {
            requests: pathStats.requests,
            successes: pathStats.successes,
            failures: pathStats.failures,
            ...summarizeDurations(pathStats.durations),
        };
    });
    stats.perPath = perPathSummary;
    await mkdir('reports', { recursive: true });
    await writeFile('reports/load-test-report.json', JSON.stringify(stats, null, 2));
    console.log(`[load-test] Completed ${stats.totals.requests} requests against ${baseUrl} in ${durationMs}ms.`);
    console.log('[load-test] Report saved to reports/load-test-report.json');
}

run().catch(error => {
    console.error('[load-test] Failed to run load test:', error);
    process.exit(1);
});
