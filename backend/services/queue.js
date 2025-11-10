// backend/services/queue.js
/**
 * Centralized BullMQ setup for the job processing pipeline.
 * Provides named queues for each stage and a helper to register workers.
 */

const { Queue, Worker } = require('bullmq');
const { redisOptions } = require('./redisOptions');
const metrics = require('./metrics');

const connection = redisOptions();

const queues = {
    extraction: new Queue('extraction', { connection }),
    validation: new Queue('validation', { connection }),
    audit: new Queue('audit', { connection }),
    classification: new Queue('classification', { connection }),
    analysis: new Queue('analysis', { connection }),
    indexing: new Queue('indexing', { connection }),
};

const activeWorkers = new Map();

function updateActiveGauge(queueName, delta) {
    const next = Math.max(0, (activeWorkers.get(queueName) || 0) + delta);
    activeWorkers.set(queueName, next);
    metrics.setGauge(`queue_${queueName}_active_workers`, next);
}

function registerWorker(queueName, processor, opts = {}) {
    const wrappedProcessor = async (job) => {
        metrics.incrementCounter(`queue_${queueName}_started_total`);
        updateActiveGauge(queueName, 1);
        const startedAt = Date.now();
        try {
            const result = await processor(job);
            metrics.incrementCounter(`queue_${queueName}_completed_total`);
            return result;
        } catch (error) {
            metrics.incrementCounter(`queue_${queueName}_failed_total`);
            throw error;
        } finally {
            const duration = Date.now() - startedAt;
            metrics.observeSummary(`queue_${queueName}_duration_ms`, duration);
            updateActiveGauge(queueName, -1);
        }
    };

    return new Worker(queueName, wrappedProcessor, {
        connection,
        concurrency: opts.concurrency || 1,
    });
}

module.exports = {
    queues,
    registerWorker,
    connection,
};
