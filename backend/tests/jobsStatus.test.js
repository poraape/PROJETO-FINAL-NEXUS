const express = require('express');
const request = require('supertest');

const jobsRouterFactory = require('../routes/jobs');

describe('GET /api/jobs/:jobId/status', () => {
    let context;
    let app;

    beforeEach(() => {
        const genericUploadMiddleware = () => (req, res, next) => next();
        context = {
            upload: { array: jest.fn(() => genericUploadMiddleware()) },
            redisClient: {
                get: jest.fn(),
                set: jest.fn(),
            },
            processFilesInBackground: jest.fn(),
            embeddingModel: {},
            model: {},
            availableTools: {},
            weaviate: {},
            storageService: {
                persistUploadedFiles: jest.fn(),
            },
            logger: {
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            },
        };

        app = express();
        app.use('/api/jobs', jobsRouterFactory(context));
    });

    it('returns langChain insights stored in job result', async () => {
        const jobId = 'job-with-langchain';
        const jobSnapshot = {
            status: 'completed',
            result: {
                executiveSummary: { title: 'Resumo', description: 'Texto' },
                langChainAudit: 'Avaliado',
                langChainAuditFindings: 'Achados importantes',
                langChainClassification: 'Classificação aprovada',
            },
            pipeline: [],
        };
        context.redisClient.get.mockResolvedValue(JSON.stringify(jobSnapshot));

        const response = await request(app).get(`/api/jobs/${jobId}/status`);

        expect(response.status).toBe(200);
        expect(response.body.result).toMatchObject({
            langChainAudit: expect.any(String),
            langChainAuditFindings: expect.any(String),
            langChainClassification: expect.any(String),
        });
        expect(response.body.result.langChainAudit).toBe('Avaliado');
        expect(response.body.result.langChainAuditFindings).toBe('Achados importantes');
        expect(response.body.result.langChainClassification).toBe('Classificação aprovada');
    });
});
