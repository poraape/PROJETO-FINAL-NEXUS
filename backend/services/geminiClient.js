// backend/services/geminiClient.js
const { GoogleGenAI } = require('@google/genai');
const tools = require('./tools');

const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY não definido. Verifique o arquivo .env do backend.');
}

const MODEL_NAME = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
const EMBEDDING_MODEL_NAME = process.env.GEMINI_EMBEDDING_MODEL_ID || 'text-embedding-004';

const MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || '2', 10);
const RETRY_BASE_DELAY_MS = parseInt(process.env.GEMINI_RETRY_BASE_DELAY_MS || '500', 10);

const client = new GoogleGenAI({ apiKey: geminiApiKey });

function normalizeGeminiError(error) {
    if (!error) {
        return new Error('Falha desconhecida ao chamar a API Gemini.');
    }

    const message = typeof error.message === 'string' ? error.message : String(error);

    if (/NOT_FOUND/.test(message) || /404/.test(message)) {
        return new Error('Modelo Gemini configurado não está disponível. Verifique se o ID do modelo é válido e suportado.');
    }

    if (/429/.test(message) || /RESOURCE_EXHAUSTED/.test(message)) {
        return new Error('A API Gemini retornou limite excedido (429). Tente novamente em instantes ou reduza o volume de solicitações.');
    }

    if (/PERMISSION_DENIED/.test(message) || /401/.test(message)) {
        return new Error('A chamada à API Gemini foi rejeitada por credenciais inválidas. Verifique a chave configurada.');
    }

    return new Error(`Falha na API Gemini: ${message}`);
}

function shouldRetryGemini(error) {
    const message = (error && error.message) ? error.message.toLowerCase() : '';
    return (
        message.includes('429') ||
        message.includes('resource_exhausted') ||
        message.includes('internal') ||
        message.includes('unavailable') ||
        message.includes('timeout')
    );
}

async function executeWithRetry(operation, attempt = 0) {
    try {
        return await operation();
    } catch (err) {
        if (attempt >= MAX_RETRIES || !shouldRetryGemini(err)) {
            throw normalizeGeminiError(err);
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[GeminiClient] Falha na tentativa ${attempt + 1}. Retentando em ${delay}ms...`, err.message);
        await new Promise(res => setTimeout(res, delay));
        return executeWithRetry(operation, attempt + 1);
    }
}

const availableTools = {
    tax_simulation: tools.tax_simulation,
    cnpj_validation: tools.cnpj_validation,
};

const functionDeclarationsRegistry = {
    tax_simulation: {
        name: 'tax_simulation',
        description: 'Simula o cálculo de impostos para um determinado valor base e regime tributário.',
        parameters: {
            type: 'OBJECT',
            properties: {
                baseValue: { type: 'NUMBER' },
                taxRegime: { type: 'STRING', enum: ['Lucro Presumido', 'Lucro Real', 'Simples Nacional'] },
            },
            required: ['baseValue', 'taxRegime'],
        },
    },
    cnpj_validation: {
        name: 'cnpj_validation',
        description: 'Valida um CNPJ utilizando a BrasilAPI e retorna os dados consolidados.',
        parameters: {
            type: 'OBJECT',
            properties: {
                cnpj: { type: 'STRING', description: 'Número do CNPJ (com ou sem máscara).' },
            },
            required: ['cnpj'],
        },
    },
};

function buildToolDeclarations(toolMap) {
    const toolNames = toolMap ? Object.keys(toolMap) : Object.keys(availableTools);
    const declarations = toolNames
        .map(name => functionDeclarationsRegistry[name])
        .filter(Boolean);

    return declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined;
}

function wrapResponse(response) {
    return {
        raw: response,
        response: {
            text: () => response.text ?? '',
            functionCalls: () => response.functionCalls ?? [],
            candidates: response.candidates ?? [],
        },
    };
}

const model = {
    async generateContent(params) {
        const { contents, generationConfig, ...rest } = params || {};
        const response = await executeWithRetry(() => client.models.generateContent({
            model: MODEL_NAME,
            contents,
            config: {
                ...(generationConfig || {}),
                tools: buildToolDeclarations(availableTools),
            },
            ...rest,
        }));
        return wrapResponse(response);
    },
    startChat(options = {}) {
        const { tools: toolOverrides, history, config } = options;
        const chat = client.chats.create({
            model: MODEL_NAME,
            history,
            config: {
                ...(config || {}),
                tools: buildToolDeclarations(toolOverrides || availableTools),
            },
        });

        return {
            async sendMessage(message) {
                let payload;
                if (typeof message === 'string' || Array.isArray(message)) {
                    payload = { message };
                } else if (message && typeof message === 'object' && 'message' in message) {
                    payload = message;
                } else {
                    payload = { message };
                }

                const response = await executeWithRetry(() => chat.sendMessage(payload));
                return wrapResponse(response);
            },
        };
    },
};

const embeddingModel = {
    async embedContent(content) {
        const text = typeof content === 'string' ? content : content?.content || '';
        const response = await executeWithRetry(() => client.models.embedContent({
            model: EMBEDDING_MODEL_NAME,
            contents: [text],
        }));
        const embedding = response.embeddings?.[0] || { values: [] };
        return { embedding };
    },
    async batchEmbedContents({ requests }) {
        const results = await Promise.all(
            (requests || []).map(({ model: requestModel, content }) =>
                executeWithRetry(() => client.models.embedContent({
                    model: requestModel || EMBEDDING_MODEL_NAME,
                    contents: [content],
                }))
            )
        );

        return {
            embeddings: results.map(res => res.embeddings?.[0] || { values: [] }),
        };
    },
};

module.exports = {
    client,
    model,
    embeddingModel,
    availableTools,
};
