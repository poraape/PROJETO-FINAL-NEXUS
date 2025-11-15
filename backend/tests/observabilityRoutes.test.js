const express = require('express');
const request = require('supertest');

jest.mock('../services/telemetryStore', () => ({
    getOverview: jest.fn(() => ({ totals: { trackedJobs: 1, running: 1, failed: 0, completed: 0 }, taskStats: {} })),
    getJobTelemetry: jest.fn(() => ({
        jobId: 'job-42',
        timeline: [],
        statusHistory: [],
        taskStats: {},
    })),
}));

const telemetryStore = require('../services/telemetryStore');
const observabilityRouter = require('../routes/observability');

describe('Observability routes', () => {
    let app;
    let context;

    beforeEach(() => {
        context = {
            redisClient: {
                get: jest.fn().mockResolvedValue(JSON.stringify({
                    status: 'completed',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    pipeline: [],
                })),
            },
        };
        app = express();
        app.use((req, res, next) => {
            req.auth = { scopes: ['jobs:read'], orgId: 'default' };
            next();
        });
        app.use('/api/observability', observabilityRouter(context));
    });

    it('returns overview snapshot', async () => {
        const response = await request(app).get('/api/observability/overview');
        expect(response.status).toBe(200);
        expect(response.body.totals.trackedJobs).toBe(1);
        expect(telemetryStore.getOverview).toHaveBeenCalled();
    });

    it('returns job timeline payload', async () => {
        const response = await request(app).get('/api/observability/jobs/job-42');
        expect(response.status).toBe(200);
        expect(response.body.jobId).toBe('job-42');
        expect(telemetryStore.getJobTelemetry).toHaveBeenCalledWith('job-42');
    });
});
