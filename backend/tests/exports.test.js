process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.NODE_ENV = 'test';

jest.mock('multer');
jest.mock('../services/storage', () => require('./helpers/storageMock'));

const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    expire: jest.fn(),
    ping: jest.fn(),
};

jest.mock('../services/redisClient', () => mockRedisClient);
jest.mock('../services/eventBus', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../services/langchainClient', () => ({
    diagnostics: jest.fn().mockResolvedValue({ ready: true }),
    runChat: jest.fn(),
    runAnalysis: jest.fn(),
    reset: jest.fn(),
}));

jest.mock('../services/exporter', () => {
    const summarizeDoc = jest.fn(doc => doc);
    return {
        __esModule: true,
        default: {},
        extractDocumentsFromStorage: jest.fn(),
        gerarSpedFiscal: jest.fn(),
        gerarEfdContribuicoes: jest.fn(),
        gerarCsvERP: jest.fn(),
        gerarCsvLancamentos: jest.fn(),
        summarizeDoc,
    };
});

jest.mock('../services/reconciliation', () => ({
    parseStatements: jest.fn(),
    reconcile: jest.fn(),
}));

jest.mock('../services/weaviateClient', () => ({
    className: 'TestClass',
    client: {
        graphql: {
            get: jest.fn(() => ({
                withClassName: jest.fn().mockReturnThis(),
                withFields: jest.fn().mockReturnThis(),
                withWhere: jest.fn().mockReturnThis(),
                withNearVector: jest.fn().mockReturnThis(),
                withLimit: jest.fn().mockReturnThis(),
                do: jest.fn(),
            })),
        },
    },
}));

jest.mock('../services/geminiClient', () => ({
    embeddingModel: {},
    model: {},
    availableTools: {},
}));

const exporterService = require('../services/exporter');
const reconciliationService = require('../services/reconciliation');
const { app } = require('../server');
const requestApp = require('./utils/request');

describe('Exports and reconciliation endpoints', () => {
    const jobId = 'job-exports-1';
    const baseJob = {
        uploadedFiles: [{ name: 'nf-1.xml', hash: 'hash-1', size: 100 }],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisClient.get.mockImplementation((key) => {
            if (key === `job:${jobId}`) {
                return Promise.resolve(JSON.stringify(baseJob));
            }
            return Promise.resolve(null);
        });
        exporterService.extractDocumentsFromStorage.mockResolvedValue({
            documentos: [{ chave: '123', total: { vNF: '100' } }],
            log: [],
        });
        exporterService.gerarCsvERP.mockReturnValue('csv-content');
        exporterService.gerarSpedFiscal.mockReturnValue('sped');
        exporterService.gerarEfdContribuicoes.mockReturnValue('efd');
        exporterService.gerarCsvLancamentos.mockReturnValue('ledger');
        reconciliationService.parseStatements.mockResolvedValue([{ date: '2024-01-01', amount: 100 }]);
        reconciliationService.reconcile.mockReturnValue({
            summary: { totalInvoices: 1, totalTransactions: 1, reconciled: 1, pendingInvoices: 0, pendingTransactions: 0 },
            matches: [],
            pendingInvoices: [],
            pendingTransactions: [],
        });
    });

    describe('POST /api/jobs/:jobId/exports', () => {
        it('should reject invalid export format', async () => {
            const response = await requestApp(app, {
                method: 'POST',
                path: `/api/jobs/${jobId}/exports`,
                multipart: { fields: { format: 'pdf' } },
            });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Formato de exportação inválido.');
        });

        it('should return CSV payload using backend exporter', async () => {
            const response = await requestApp(app, {
                method: 'POST',
                path: `/api/jobs/${jobId}/exports`,
                multipart: { fields: { format: 'csv' } },
            });

            expect(response.status).toBe(200);
            expect(exporterService.extractDocumentsFromStorage).toHaveBeenCalledTimes(1);
            expect(exporterService.gerarCsvERP).toHaveBeenCalledTimes(1);
            expect(response.body.fileName).toBe('ERP_IMPORT.csv');
            const decoded = Buffer.from(response.body.content, 'base64').toString('utf8');
            expect(decoded).toBe('csv-content');
        });
    });

    describe('POST /api/jobs/:jobId/reconciliation', () => {
        it('should require at least one statement file', async () => {
            const response = await requestApp(app, {
                method: 'POST',
                path: `/api/jobs/${jobId}/reconciliation`,
            });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Envie pelo menos um arquivo OFX ou CSV.');
        });

        it('should reconcile statements successfully', async () => {
            const response = await requestApp(app, {
                method: 'POST',
                path: `/api/jobs/${jobId}/reconciliation`,
                multipart: {
                    files: [
                        { fieldName: 'statements', filename: 'bank.ofx', buffer: Buffer.from('dummy'), contentType: 'application/octet-stream' },
                    ],
                },
            });

            expect(response.status).toBe(200);
            expect(reconciliationService.parseStatements).toHaveBeenCalledTimes(1);
            expect(reconciliationService.reconcile).toHaveBeenCalledTimes(1);
            expect(response.body.summary.reconciled).toBe(1);
        });
    });
});
