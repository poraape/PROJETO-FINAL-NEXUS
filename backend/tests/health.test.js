const request = require('supertest');
const server = require('../server'); // Importa o servidor (sem iniciar a escuta)
const redisClient = require('../services/redisClient');
const weaviate = require('../services/weaviateClient');

// Mock dos serviços externos
jest.mock('../services/redisClient', () => ({
    ping: jest.fn(),
}));

jest.mock('../services/weaviateClient', () => ({
    client: {
        misc: {
            liveChecker: jest.fn().mockReturnThis(),
            do: jest.fn(),
        },
    },
}));

describe('GET /api/health', () => {
    let originalApiKey;

    beforeAll(() => {
        originalApiKey = process.env.GEMINI_API_KEY;
    });

    afterAll(() => {
        process.env.GEMINI_API_KEY = originalApiKey;
        server.close(); // Fecha o servidor após todos os testes
    });

    beforeEach(() => {
        // Reseta os mocks antes de cada teste
        jest.clearAllMocks();
        process.env.GEMINI_API_KEY = 'test-key'; // Define uma chave padrão para os testes
    });

    it('should return 200 OK when all services are healthy', async () => {
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.client.misc.liveChecker().do.mockResolvedValue(true);

        const response = await request(server).get('/api/health');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
        expect(response.body.services.redis).toBe('ok');
        expect(response.body.services.weaviate).toBe('ok');
        expect(response.body.services.gemini_api).toBe('ok');
    });

    it('should return 503 Service Unavailable when Redis is down', async () => {
        const redisError = new Error('Redis connection failed');
        redisClient.ping.mockRejectedValue(redisError);
        weaviate.client.misc.liveChecker().do.mockResolvedValue(true);

        const response = await request(server).get('/api/health');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.redis).toBe(`error: ${redisError.message}`);
        expect(response.body.services.weaviate).toBe('ok');
    });

    it('should return 503 Service Unavailable when Weaviate is down', async () => {
        const weaviateError = new Error('Weaviate not live');
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.client.misc.liveChecker().do.mockRejectedValue(weaviateError);

        const response = await request(server).get('/api/health');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.redis).toBe('ok');
        expect(response.body.services.weaviate).toBe(`error: ${weaviateError.message}`);
    });

    it('should return 503 Service Unavailable when Gemini API key is missing', async () => {
        delete process.env.GEMINI_API_KEY; // Remove a chave de API
        redisClient.ping.mockResolvedValue('PONG');
        weaviate.client.misc.liveChecker().do.mockResolvedValue(true);

        const response = await request(server).get('/api/health');

        expect(response.status).toBe(503);
        expect(response.body.status).toBe('error');
        expect(response.body.services.redis).toBe('ok');
        expect(response.body.services.weaviate).toBe('ok');
        expect(response.body.services.gemini_api).toBe('error: API key not configured');
    });
});