process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.NODE_ENV = 'test';

const mockRedisClient = {
    ping: jest.fn(),
};

const mockWeaviateClientFactory = () => {
    const liveCheckerResult = { do: jest.fn() };
    return {
        client: {
            misc: {
                liveChecker: jest.fn(() => liveCheckerResult),
            },
        },
        __liveCheckerResult: liveCheckerResult,
    };
};

const mockWeaviateClient = mockWeaviateClientFactory();

jest.mock('../services/redisClient', () => mockRedisClient);
jest.mock('../services/weaviateClient', () => mockWeaviateClient);
jest.mock('../services/eventBus', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../services/langchainBridge', () => ({
    isReady: jest.fn(() => true),
    getDiagnostics: jest.fn(() => ({ readySince: 'test' })),
}));
jest.mock('../services/langchainClient', () => ({
    diagnostics: jest.fn().mockResolvedValue({ ready: true }),
    runChat: jest.fn(),
    runAnalysis: jest.fn(),
    reset: jest.fn(),
}));

const redisClient = require('../services/redisClient');
const weaviate = require('../services/weaviateClient');
const langchainBridge = require('../services/langchainBridge');
const { app } = require('../server');
const requestApp = require('./utils/request');

describe('GET /api/health', () => {
    let originalApiKey;

    beforeAll(() => {
        originalApiKey = process.env.GEMINI_API_KEY;
    });

    afterAll(() => {
        process.env.GEMINI_API_KEY = originalApiKey;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GEMINI_API_KEY = 'test-key'; // Define uma chave padrão para os testes
        mockRedisClient.ping.mockReset();
        const freshLiveChecker = { do: jest.fn() };
        mockWeaviateClient.client.misc.liveChecker.mockImplementation(() => freshLiveChecker);
        mockWeaviateClient.__liveCheckerResult = freshLiveChecker;
        weaviate.__liveCheckerResult = freshLiveChecker;
        langchainBridge.isReady.mockReturnValue(true);
    });

    it('should return 200 OK when all services are healthy', async () => {
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.__liveCheckerResult.do.mockResolvedValue(true);

        const response = await requestApp(app, { method: 'GET', path: '/api/health' });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body.services.redis).toBe('ok');
        expect(response.body.services.weaviate).toBe('ok');
        expect(response.body.services.gemini_api).toBe('ok');
        expect(response.body.services.langchain).toBe('ok');
    });

    it('should return 503 Service Unavailable when Redis is down', async () => {
        const redisError = new Error('Redis connection failed');
        redisClient.ping.mockRejectedValue(redisError);
        weaviate.__liveCheckerResult.do.mockResolvedValue(true);

        const response = await requestApp(app, { method: 'GET', path: '/api/health' });

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.redis).toBe(`error: ${redisError.message}`);
        expect(response.body.services.weaviate).toBe('ok');
        expect(response.body.services.langchain).toBe('ok');
    });

    it('should return 503 Service Unavailable when Weaviate is down', async () => {
        const weaviateError = new Error('Weaviate not live');
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.__liveCheckerResult.do.mockRejectedValue(weaviateError);

        const response = await requestApp(app, { method: 'GET', path: '/api/health' });

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.redis).toBe('ok');
        expect(response.body.services.weaviate).toBe(`error: ${weaviateError.message}`);
        expect(response.body.services.langchain).toBe('ok');
    });

    it('should return 503 Service Unavailable when Gemini API key is missing', async () => {
        process.env.GEMINI_API_KEY = ''; // Simula ausência da chave de API
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.__liveCheckerResult.do.mockResolvedValue(true);

        const response = await requestApp(app, { method: 'GET', path: '/api/health' });

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.redis).toBe('ok');
        expect(response.body.services.weaviate).toBe('ok');
        expect(response.body.services.gemini_api).toBe('error: API key not configured');
        expect(response.body.services.langchain).toBe('ok');
    });

    it('should surface LangChain readiness errors', async () => {
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.__liveCheckerResult.do.mockResolvedValue(true);
        langchainBridge.isReady.mockReturnValue(false);

        const response = await requestApp(app, { method: 'GET', path: '/api/health' });

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.langchain).toMatch(/error/i);
    });
});
