// backend/services/telemetryStore.js
const { jobTtlSeconds } = require('../config/cache');
const logger = require('./logger').child({ module: 'telemetryStore' });
const metrics = require('./metrics');

const telemetryMap = new Map();
const retentionMs = Number(process.env.TELEMETRY_RETENTION_MS || jobTtlSeconds * 1000);
const maxTimelineEntries = Number(process.env.TELEMETRY_TIMELINE_LIMIT || 120);

function sanitizeMeta(meta = {}) {
    if (!meta || typeof meta !== 'object') return undefined;
    const safe = {};
    if (typeof meta.message === 'string') safe.message = meta.message.slice(0, 300);
    if (typeof meta.error === 'string') safe.error = meta.error.slice(0, 300);
    if (typeof meta.status === 'string') safe.status = meta.status;
    if (typeof meta.taskName === 'string') safe.taskName = meta.taskName;
    if (typeof meta.currentStep === 'string') safe.currentStep = meta.currentStep;
    if (typeof meta.fileCount === 'number') safe.fileCount = meta.fileCount;
    if (typeof meta.durationMs === 'number') safe.durationMs = Math.round(meta.durationMs);
    if (Array.isArray(meta.resultKeys)) safe.resultKeys = meta.resultKeys.slice(0, 10);
    if (typeof meta.totalSizeBytes === 'number') safe.totalSizeBytes = meta.totalSizeBytes;
    return Object.keys(safe).length > 0 ? safe : undefined;
}

function ensureJob(jobId) {
    if (!jobId) return null;
    if (!telemetryMap.has(jobId)) {
        telemetryMap.set(jobId, {
            jobId,
            createdAt: new Date().toISOString(),
            lastUpdatedAt: Date.now(),
            timeline: [],
            statusHistory: [],
            activeTasks: new Map(),
            durationStats: new Map(),
        });
    }
    return telemetryMap.get(jobId);
}

function pushTimelineEntry(bucket, entry) {
    bucket.timeline.push(entry);
    bucket.lastUpdatedAt = Date.now();
    if (bucket.timeline.length > maxTimelineEntries) {
        bucket.timeline.splice(0, bucket.timeline.length - maxTimelineEntries);
    }
}

function updateDurationStats(bucket, taskName, durationMs) {
    if (!taskName || durationMs == null) return;
    const stats = bucket.durationStats.get(taskName) || { runs: 0, totalDuration: 0, maxDuration: 0 };
    stats.runs += 1;
    stats.totalDuration += durationMs;
    stats.maxDuration = Math.max(stats.maxDuration, durationMs);
    stats.lastDurationMs = durationMs;
    stats.avgDurationMs = stats.totalDuration / stats.runs;
    bucket.durationStats.set(taskName, stats);
}

function recordTaskStart(jobId, taskName, meta = {}) {
    if (!jobId || !taskName) return;
    const bucket = ensureJob(jobId);
    const timestamp = new Date().toISOString();
    bucket.activeTasks.set(taskName, Date.now());
    pushTimelineEntry(bucket, {
        type: 'task:start',
        taskName,
        timestamp,
        meta: sanitizeMeta({ ...meta, taskName }),
    });
    metrics.incrementCounter(`telemetry_${taskName}_started_total`);
}

function recordTaskEnd(jobId, taskName, status, meta = {}) {
    if (!jobId || !taskName) return;
    const bucket = ensureJob(jobId);
    const startedAt = bucket.activeTasks.get(taskName);
    const durationMs = typeof startedAt === 'number' ? Date.now() - startedAt : undefined;
    bucket.activeTasks.delete(taskName);
    updateDurationStats(bucket, taskName, durationMs);
    if (typeof durationMs === 'number') {
        metrics.observeSummary(`task_${taskName}_duration_ms`, durationMs);
    }
    if (status === 'failed') {
        metrics.incrementCounter(`telemetry_${taskName}_failed_total`);
    } else {
        metrics.incrementCounter(`telemetry_${taskName}_completed_total`);
    }
    pushTimelineEntry(bucket, {
        type: 'task:end',
        taskName,
        status,
        durationMs,
        timestamp: new Date().toISOString(),
        meta: sanitizeMeta({ ...meta, taskName, durationMs }),
    });
}

function recordJobStatus(jobId, status, meta = {}) {
    if (!jobId || !status) return;
    const bucket = ensureJob(jobId);
    const entry = {
        status,
        timestamp: new Date().toISOString(),
        meta: sanitizeMeta(meta),
    };
    bucket.statusHistory.push(entry);
    bucket.lastStatus = status;
    pushTimelineEntry(bucket, { type: 'job:status', ...entry });
    if (status === 'queued') {
        metrics.incrementCounter('jobs_queued_total');
    } else if (status === 'processing') {
        metrics.incrementCounter('jobs_processing_total');
    } else if (status === 'completed') {
        metrics.incrementCounter('jobs_completed_total');
    } else if (status === 'failed') {
        metrics.incrementCounter('jobs_failed_total');
    }
}

function getJobTelemetry(jobId) {
    const bucket = telemetryMap.get(jobId);
    if (!bucket) return null;
    return {
        jobId: bucket.jobId,
        createdAt: bucket.createdAt,
        lastUpdatedAt: new Date(bucket.lastUpdatedAt).toISOString(),
        lastStatus: bucket.lastStatus,
        timeline: bucket.timeline.slice(),
        statusHistory: bucket.statusHistory.slice(),
        taskStats: Object.fromEntries(
            Array.from(bucket.durationStats.entries()).map(([taskName, stats]) => [
                taskName,
                {
                    runs: stats.runs,
                    avgDurationMs: Math.round(stats.avgDurationMs || 0),
                    maxDurationMs: Math.round(stats.maxDuration || 0),
                    lastDurationMs: typeof stats.lastDurationMs === 'number' ? Math.round(stats.lastDurationMs) : null,
                },
            ])
        ),
    };
}

function getOverview() {
    const now = Date.now();
    const totals = {
        trackedJobs: telemetryMap.size,
        running: 0,
        queued: 0,
        failed: 0,
        completed: 0,
    };
    const taskAverages = {};

    telemetryMap.forEach(bucket => {
        if (bucket.lastStatus === 'failed') totals.failed += 1;
        else if (bucket.lastStatus === 'completed') totals.completed += 1;
        else if (bucket.lastStatus === 'queued') totals.queued += 1;
        else totals.running += 1;

        bucket.durationStats.forEach((stats, taskName) => {
            const record = taskAverages[taskName] || { runs: 0, total: 0 };
            record.runs += stats.runs;
            record.total += stats.totalDuration;
            record.max = Math.max(record.max || 0, stats.maxDuration);
            taskAverages[taskName] = record;
        });

        if (now - bucket.lastUpdatedAt > retentionMs) {
            telemetryMap.delete(bucket.jobId);
        }
    });

    const normalizedTaskStats = Object.fromEntries(
        Object.entries(taskAverages).map(([taskName, stats]) => [
            taskName,
            {
                runs: stats.runs,
                avgDurationMs: stats.runs ? Math.round(stats.total / stats.runs) : 0,
                maxDurationMs: Math.round(stats.max || 0),
            },
        ])
    );

    return {
        totals,
        taskStats: normalizedTaskStats,
        retentionSeconds: Math.round(retentionMs / 1000),
    };
}

function pruneExpired() {
    const now = Date.now();
    telemetryMap.forEach((bucket, jobId) => {
        if (now - bucket.lastUpdatedAt > retentionMs) {
            logger.debug('telemetry_job_pruned', { jobId });
            telemetryMap.delete(jobId);
        }
    });
}

const pruneIntervalMs = Math.max(30000, Math.min(retentionMs, 5 * 60 * 1000));
if (process.env.NODE_ENV !== 'test') {
    const interval = setInterval(pruneExpired, pruneIntervalMs);
    if (typeof interval.unref === 'function') interval.unref();
}

function resetForTests() {
    telemetryMap.clear();
}

module.exports = {
    recordTaskStart,
    recordTaskEnd,
    recordJobStatus,
    getJobTelemetry,
    getOverview,
    __dangerousReset: resetForTests,
};
