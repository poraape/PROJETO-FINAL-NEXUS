const EventEmitter = require('events');
const { registerLangChainOrchestrator } = require('../langchain/orchestrator');
const { createWeaviateMock } = require('./helpers/weaviateMock');

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

const createMetricsMock = () => ({
    incrementCounter: jest.fn(),
    observeSummary: jest.fn(),
});

describe('End-to-end pipeline simulation', () => {
    let context;
    let jobStore;
    let metricsMock;

    beforeEach(() => {
        jobStore = new Map();
        metricsMock = createMetricsMock();
        const mergeJobResult = jest.fn(async (jobId, data) => {
            const job = jobStore.get(jobId) ?? { result: {} };
            job.result = { ...(job.result || {}), ...(data || {}) };
            jobStore.set(jobId, job);
        });

        context = {
            eventBus: new EventEmitter(),
            weaviate: createWeaviateMock(),
            mergeJobResult,
            metrics: metricsMock,
        };

        registerLangChainOrchestrator(context);
    });

    it('persists langChain payloads through the full pipeline simulation', async () => {
        const jobId = 'pipeline-e2e';
        jobStore.set(jobId, { result: {} });
        const payload = {
            executiveSummary: {
                description: 'Resumo do job',
                keyMetrics: { numeroDeDocumentosValidos: 3 },
                actionableInsights: [{ text: 'Insight e2e' }],
            },
            validations: [{ cnpj: '123', message: 'ok' }],
            simulationResult: { resumoExecutivo: 'Simulação profunda' },
            auditFindings: {
                summary: { totalFindings: 2, riskLevel: 'Médio', riskScore: 75 },
                alerts: ['alerta e2e'],
                highValueDocuments: 1,
            },
            classifications: {
                summary: { porRisco: { Medio: 1 }, documentsWithPendingIssues: 0, recommendations: ['Revisar cfops'] },
                documentsInReview: ['docX'],
            },
        };

        context.eventBus.emit('task:completed', { jobId, taskName: 'analysis', resultPayload: payload });
        await flushPromises();
        context.eventBus.emit('task:completed', { jobId, taskName: 'audit', resultPayload: payload });
        await flushPromises();
        context.eventBus.emit('task:completed', { jobId, taskName: 'classification', resultPayload: payload });
        await flushPromises();

        const finalJob = jobStore.get(jobId);
        expect(finalJob).toBeDefined();
        const { result } = finalJob;
        expect(result?.langChainAudit).toBeDefined();
        expect(result?.langChainAuditFindings).toBeDefined();
        expect(result?.langChainClassification).toBeDefined();
        expect(context.mergeJobResult).toHaveBeenCalledTimes(3);
        expect(metricsMock.incrementCounter).toHaveBeenCalledWith('langchain_chain_runs_total');
        expect(metricsMock.incrementCounter).toHaveBeenCalledWith('langchain_chain_success_total');
    });
});
