const EventEmitter = require('events');
const { createWeaviateMock } = require('./helpers/weaviateMock');

const mockReviewChain = { call: jest.fn() };
const mockAuditChain = { call: jest.fn() };
const mockClassificationChain = { call: jest.fn() };

jest.mock('../langchain/chains', () => ({
  createReviewChain: jest.fn(() => mockReviewChain),
  createAuditChain: jest.fn(() => mockAuditChain),
  createClassificationChain: jest.fn(() => mockClassificationChain),
}));

const { registerLangChainOrchestrator } = require('../langchain/orchestrator');

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

const createMetricsMock = () => ({
  incrementCounter: jest.fn(),
  observeSummary: jest.fn(),
});

const basePayload = {
  executiveSummary: {
    description: 'Resumo sintetizado',
    keyMetrics: { numeroDeDocumentosValidos: 2 },
    actionableInsights: [{ text: 'Insight primário' }],
  },
  validations: [{ cnpj: '000000', message: 'Validação concluída' }],
  simulationResult: { resumoExecutivo: 'Simulação confirmada' },
  auditFindings: {
    summary: {
      totalFindings: 1,
      riskLevel: 'Alto',
      riskScore: 88,
    },
    alerts: ['alerta crítico'],
    highValueDocuments: 1,
  },
  classifications: {
    summary: {
      porRisco: { Alto: 1 },
      documentsWithPendingIssues: 2,
      recommendations: ['Recomendações estratégicas'],
    },
    documentsInReview: ['docA'],
  },
};

describe('registerLangChainOrchestrator', () => {
  let context;
  let metricsMock;

  beforeEach(() => {
    mockReviewChain.call.mockReset().mockResolvedValue({ langChainAudit: '"revisão" completa' });
    mockAuditChain.call.mockReset().mockResolvedValue({ langChainAuditFindings: '"achados" completos' });
    mockClassificationChain.call.mockReset().mockResolvedValue({ langChainClassification: '"classificação" pronta' });

    metricsMock = createMetricsMock();
    context = {
      eventBus: new EventEmitter(),
      weaviate: createWeaviateMock(),
      mergeJobResult: jest.fn(),
      metrics: metricsMock,
    };

    registerLangChainOrchestrator(context);
  });

  it('persists the LangChain review for analysis tasks', async () => {
    const jobId = 'analysis-job';
    context.eventBus.emit('task:completed', { jobId, taskName: 'analysis', resultPayload: basePayload });
    await flushPromises();
    expect(mockReviewChain.call).toHaveBeenCalledWith(expect.objectContaining({ jobId }));
    expect(context.mergeJobResult).toHaveBeenCalledWith(jobId, { langChainAudit: '"revisão" completa' });
  });

  it('persists LangChain findings for audit tasks', async () => {
    const jobId = 'audit-job';
    context.eventBus.emit('task:completed', { jobId, taskName: 'audit', resultPayload: basePayload });
    await flushPromises();
    expect(mockAuditChain.call).toHaveBeenCalledWith(expect.objectContaining({ jobId }));
    expect(context.mergeJobResult).toHaveBeenCalledWith(jobId, { langChainAuditFindings: '"achados" completos' });
  });

  it('persists LangChain classification output', async () => {
    const jobId = 'classification-job';
    context.eventBus.emit('task:completed', { jobId, taskName: 'classification', resultPayload: basePayload });
    await flushPromises();
    expect(mockClassificationChain.call).toHaveBeenCalledWith(expect.objectContaining({ jobId }));
    expect(context.mergeJobResult).toHaveBeenCalledWith(jobId, { langChainClassification: '"classificação" pronta' });
  });
});
