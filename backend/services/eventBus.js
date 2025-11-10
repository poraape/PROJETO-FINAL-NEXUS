const EventEmitter = require('events');
const { queues, registerWorker } = require('./queue');
const metrics = require('./metrics');

const emitter = new EventEmitter();

const TASK_QUEUES = ['extraction', 'validation', 'audit', 'classification', 'analysis', 'indexing'];
const startHandlers = [];
const workersStarted = new Set();

function ensureWorkers() {
    TASK_QUEUES.forEach(queueName => {
        if (workersStarted.has(queueName)) return;
        registerWorker(queueName, async job => {
            const payload = job.data?.payload || {};
            const jobId = job.data?.jobId;
            const data = { jobId, taskName: queueName, payload };
            for (const handler of startHandlers) {
                await handler(data);
            }
        });
        workersStarted.add(queueName);
    });
}

async function emit(eventName, payload) {
    if (eventName === 'task:start') {
        const { taskName, jobId, payload: dataPayload } = payload;
        const queue = queues[taskName];
        if (!queue) {
            throw new Error(`Queue '${taskName}' not configured.`);
        }
        await queue.add(taskName, { jobId, payload: dataPayload }, { removeOnComplete: true });
        metrics.incrementCounter(`queue_${taskName}_enqueued_total`);
        return;
    }
    emitter.emit(eventName, payload);
}

function on(eventName, handler) {
    if (eventName === 'task:start') {
        startHandlers.push(handler);
        ensureWorkers();
        return;
    }
    emitter.on(eventName, handler);
}

module.exports = {
    emit,
    on,
};
