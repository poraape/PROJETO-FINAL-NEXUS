// backend/routes/observability.js
const express = require('express');
const telemetryStore = require('../services/telemetryStore');
const { requireAuth, requireScopes, enforceJobOwnership } = require('../middleware/auth');
const { withJobContext } = require('../middleware/jobContext');

module.exports = (context) => {
    const router = express.Router();
    router.use(requireAuth);
    const loadJobContext = withJobContext(context.redisClient);

    router.get(
        '/overview',
        requireScopes(['jobs:read']),
        (req, res) => {
            const snapshot = telemetryStore.getOverview();
            return res.status(200).json(snapshot);
        }
    );

    router.get(
        '/jobs/:jobId',
        requireScopes(['jobs:read']),
        loadJobContext,
        enforceJobOwnership,
        (req, res) => {
            const telemetry = telemetryStore.getJobTelemetry(req.params.jobId);
            if (!telemetry) {
                return res.status(404).json({ message: 'Nenhum evento de telemetria registrado para este job.' });
            }
            const job = req.jobRecord;
            return res.status(200).json({
                jobId: req.params.jobId,
                jobStatus: job.status,
                createdAt: job.createdAt,
                completedAt: job.completedAt,
                pipeline: job.pipeline,
                telemetry,
            });
        }
    );

    return router;
};
