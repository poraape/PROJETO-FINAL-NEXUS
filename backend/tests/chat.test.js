const request = require('supertest');
const server = require('../server'); // Importa a instância do servidor
const weaviate = require('../services/weaviateClient');
const { model, embeddingModel } = require('../services/geminiClient');

// Mock dos serviços externos
jest.mock('../services/weaviateClient', () => ({
    className: 'TestClass',
    client: {
        graphql: {
            get: jest.fn().mockReturnThis(),
            withClassName: jest.fn().mockReturnThis(),
            withFields: jest.fn().mockReturnThis(),
            withWhere: jest.fn().mockReturnThis(),
            withNearVector: jest.fn().mockReturnThis(),
            withLimit: jest.fn().mockReturnThis(),
            do: jest.fn(),
        },
    },
}));

jest.mock('../services/geminiClient', () => ({
    embeddingModel: {
        embedContent: jest.fn(),
    },
    model: {
        startChat: jest.fn().mockReturnThis(),
        sendMessage: jest.fn(),
    },
    availableTools: {
        tax_simulation: jest.fn().mockResolvedValue({ totalTax: 1500 }),
    }
}));

describe('POST /api/jobs/:jobId/chat', () => {
    const jobId = 'test-job-123';

    afterAll(() => {
        server.close(); // Fecha o servidor após todos os testes
    });

    beforeEach(() => {
        // Reseta os mocks antes de cada teste
        jest.clearAllMocks();
    });

    it('should return 400 if question is missing', async () => {
        const response = await request(server)
            .post(`/api/jobs/${jobId}/chat`)
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('A pergunta é obrigatória.');
    });

    it('should return a direct answer if no context is found', async () => {
        embeddingModel.embedContent.mockResolvedValue({ embedding: { values: [0.1, 0.2] } });
        weaviate.client.graphql.do.mockResolvedValue({ data: { Get: { [weaviate.className]: [] } } });

        const response = await request(server)
            .post(`/api/jobs/${jobId}/chat`)
            .send({ question: 'Qual o valor total?' });

        expect(response.status).toBe(200);
        expect(response.body.answer).toBe("Desculpe, não encontrei informações nos documentos fornecidos para responder a essa pergunta.");
    });

    it('should get a RAG-based answer from the AI', async () => {
        const question = 'Qual o valor total?';
        const aiAnswer = 'O valor total é R$ 1.234,56.';

        // Mock da geração de embedding
        embeddingModel.embedContent.mockResolvedValue({ embedding: { values: [0.1, 0.2] } });

        // Mock da busca no Weaviate
        weaviate.client.graphql.do.mockResolvedValue({
            data: { Get: { [weaviate.className]: [{ content: 'Nota fiscal com valor de R$ 1.234,56', fileName: 'nf-1.xml' }] } }
        });

        // Mock da resposta da IA (sem uso de ferramenta)
        model.startChat.mockReturnValue({ sendMessage: jest.fn().mockResolvedValue({ response: { text: () => aiAnswer } }) });

        const response = await request(server)
            .post(`/api/jobs/${jobId}/chat`)
            .send({ question });

        expect(response.status).toBe(200);
        expect(response.body.answer).toBe(aiAnswer);
        expect(model.sendMessage).toHaveBeenCalledWith(expect.stringContaining(question));
        expect(model.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Nota fiscal com valor de R$ 1.234,56'));
    });

    it('should handle a tool call from the AI during chat', async () => {
        const question = 'Simule os impostos para 10000.';
        const finalAiAnswer = 'A simulação para R$ 10.000,00 resultou em um total de R$ 1.500,00 em impostos.';

        embeddingModel.embedContent.mockResolvedValue({ embedding: { values: [0.3, 0.4] } });
        weaviate.client.graphql.do.mockResolvedValue({
            data: { Get: { [weaviate.className]: [{ content: 'Documento base para simulação', fileName: 'doc.pdf' }] } }
        });

        // Mock da IA: primeira resposta solicita ferramenta, segunda resposta usa o resultado
        const chatMock = {
            sendMessage: jest.fn()
                .mockResolvedValueOnce({ response: { functionCalls: () => [{ name: 'tax_simulation', args: { baseValue: 10000 } }] } })
                .mockResolvedValueOnce({ response: { text: () => finalAiAnswer } })
        };
        model.startChat.mockReturnValue(chatMock);

        const response = await request(server)
            .post(`/api/jobs/${jobId}/chat`)
            .send({ question });

        expect(response.status).toBe(200);
        expect(response.body.answer).toBe(finalAiAnswer);
        expect(require('../services/geminiClient').availableTools.tax_simulation).toHaveBeenCalledWith({ baseValue: 10000 });
        expect(chatMock.sendMessage).toHaveBeenCalledTimes(2);
    });
});