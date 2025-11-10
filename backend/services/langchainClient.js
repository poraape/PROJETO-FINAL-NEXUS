// backend/services/langchainClient.js
/**
 * Centraliza a integração real com o LangChain, encapsulando modelos, memória
 * conversacional e recuperação contextual. Fornece métodos de alto nível para
 * que agentes e rotas executem raciocínios mais ricos sem duplicar código.
 */

const logger = require('./logger').child({ module: 'langchainClient' });
const langchainBridge = require('./langchainBridge');
const weaviate = require('./weaviateClient');
const geminiClient = require('./geminiClient');

const DEFAULT_CHAT_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
const DEFAULT_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL_ID || 'text-embedding-004';
const MAX_CONTEXT_SECTIONS = parseInt(process.env.LANGCHAIN_CONTEXT_SECTIONS || '4', 10);

let modulesLoaded = null;
let llmInstance = null;
let embeddingsInstance = null;

async function loadModules() {
    if (modulesLoaded) return modulesLoaded;
    const [
        coreRunnables,
        corePrompts,
        coreParsers,
        googleGenAI,
    ] = await Promise.all([
        import('@langchain/core/runnables'),
        import('@langchain/core/prompts'),
        import('@langchain/core/output_parsers'),
        import('@langchain/google-genai'),
    ]);

    modulesLoaded = {
        RunnableSequence: coreRunnables.RunnableSequence,
        ChatPromptTemplate: corePrompts.ChatPromptTemplate,
        MessagesPlaceholder: corePrompts.MessagesPlaceholder,
        JsonOutputParser: coreParsers.JsonOutputParser,
        StringOutputParser: coreParsers.StringOutputParser,
        ChatGoogleGenerativeAI: googleGenAI.ChatGoogleGenerativeAI,
        GoogleGenerativeAIEmbeddings: googleGenAI.GoogleGenerativeAIEmbeddings,
    };
    return modulesLoaded;
}

async function ensureLLM() {
    await loadModules();
    if (llmInstance) return llmInstance;
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY é obrigatório para inicializar o LangChain.');
    }
    llmInstance = new modulesLoaded.ChatGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
        model: DEFAULT_CHAT_MODEL,
        maxOutputTokens: 2048,
        temperature: 0.2,
    });
    return llmInstance;
}

async function ensureEmbeddings() {
    await loadModules();
    if (embeddingsInstance) return embeddingsInstance;
    embeddingsInstance = new modulesLoaded.GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GEMINI_API_KEY,
        model: DEFAULT_EMBEDDING_MODEL,
    });
    return embeddingsInstance;
}

async function retrieveContext(jobId, question) {
    try {
        const embeddings = await ensureEmbeddings();
        const vector = await embeddings.embedQuery(question);
        const result = await weaviate.client.graphql.get()
            .withClassName(weaviate.className)
            .withFields('content fileName')
            .withWhere({ operator: 'Equal', path: ['jobId'], valueText: jobId })
            .withNearVector({ vector })
            .withLimit(MAX_CONTEXT_SECTIONS)
            .do();
        const chunks = result?.data?.Get?.[weaviate.className] || [];
        if (!chunks.length) return '';
        return chunks
            .map(chunk => `Trecho do arquivo ${chunk.fileName || 'desconhecido'}:\n${chunk.content}`)
            .join('\n\n');
    } catch (error) {
        logger.warn('[LangChain] Falha ao consultar vetor no Weaviate.', { error, jobId });
        return '';
    }
}

function buildAnalysisPrompt(parser) {
    const { ChatPromptTemplate } = modulesLoaded;
    const formatInstructions = parser.getFormatInstructions();
    return ChatPromptTemplate.fromMessages([
        ['system', [
            'Você é um analista fiscal sênior. Com base no contexto fornecido, produza um JSON seguindo as instruções abaixo.',
            '{formatInstructions}',
            'Use ferramentas complexas apenas quando necessário e indique no campo toolRequest quando for imprescindível executar um cálculo/consulta externa.',
        ].join('\n')],
        ['human', [
            'Pipeline atual: {pipelineOverview}',
            'Digest do payload: {digest}',
            'Hash do contexto: {contextHash}',
            'Memória recente:\n{conversationTranscript}',
            'Estatísticas agregadas:\n{stats}',
            'Contexto resumido:\n{context}',
            'Resultado da ferramenta (se houver):\n{toolResult}',
        ].join('\n\n')],
    ]).partial({ formatInstructions });
}

function buildChatPrompt() {
    const { ChatPromptTemplate } = modulesLoaded;
    return ChatPromptTemplate.fromMessages([
        ['system', [
            'Você é o copiloto fiscal oficial do Nexus QuantumI2A2.',
            'Sempre responda em português claro, cite evidências quando possível e indique limitações.',
            'Contexto consolidado:\n{knowledgeBase}',
            'Histórico recente:\n{history}',
        ].join('\n')],
        ['human', '{question}'],
    ]);
}

async function runAnalysis({
    jobId,
    stats,
    context,
    pipelineOverview,
    digest,
    conversationTranscript,
    contextHash,
    toolResult = null,
}) {
    try {
        await ensureLLM();
        const parser = new modulesLoaded.JsonOutputParser();
        const prompt = buildAnalysisPrompt(parser);
        const chain = modulesLoaded.RunnableSequence.from([
            prompt,
            llmInstance,
            parser,
        ]);

        const response = await chain.invoke({
            stats: JSON.stringify(stats || {}, null, 2),
            context: context || 'Contexto indisponível.',
            pipelineOverview: pipelineOverview || 'Sem dados.',
            digest: digest || 'Sem digest.',
            conversationTranscript: conversationTranscript || 'Sem histórico recente.',
            contextHash: contextHash || 'indefinido',
            toolResult: toolResult ? JSON.stringify(toolResult, null, 2) : 'Nenhuma ferramenta executada.',
        });

        return {
            executiveSummary: response?.executiveSummary || null,
            toolRequest: response?.toolRequest || null,
        };
    } catch (error) {
        logger.error('[LangChain] Falha ao executar cadeia de análise.', { jobId, error });
        throw error;
    }
}

async function runChat({
    jobId,
    question,
    structuredContext,
    attachmentContext,
    manualRagContext,
}) {
    await ensureLLM();
    await loadModules();

    const ragContext = manualRagContext || await retrieveContext(jobId, question);
    const knowledgeBase = [
        structuredContext && `### Contexto fiscal estruturado\n${structuredContext}`,
        ragContext && `### Contexto recuperado automaticamente\n${ragContext}`,
        attachmentContext && `### Conteúdo de anexos recentes\n${attachmentContext}`,
    ].filter(Boolean).join('\n\n---\n\n') || 'Sem contexto adicional.';

    const conversationTranscript = langchainBridge.buildTranscript(jobId, 6) || 'Sem histórico recente.';

    const prompt = buildChatPrompt();
    const chain = modulesLoaded.RunnableSequence.from([
        prompt,
        llmInstance,
        new modulesLoaded.StringOutputParser(),
    ]);

    const answer = await chain.invoke({
        question,
        knowledgeBase,
        history: conversationTranscript,
    });

    langchainBridge.appendMemory(jobId, 'assistant', answer, { source: 'chat-langchain' });
    return { answer, knowledgeBase };
}

function reset() {
    // Sem estado adicional além do LangChain bridge neste módulo.
}

async function diagnostics() {
    await loadModules();
    return {
        model: DEFAULT_CHAT_MODEL,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        vectorStoreReady: false,
    };
}

module.exports = {
    runAnalysis,
    runChat,
    reset,
    diagnostics,
};
