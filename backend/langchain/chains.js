const { LLMChain } = require('langchain/chains');
const { PromptTemplate } = require('@langchain/core/prompts');
const { BufferMemory } = require('langchain/memory');
const { GeminiLLM } = require('./llms/geminiLLM');

const DEFAULT_GENERATION_CONFIG = { responseMimeType: 'application/json' };

function createGeminiChain(context, promptTemplate, memoryKey, outputKey, additionalConfig = {}) {
    const llm = new GeminiLLM({
        geminiModel: context.model,
        modelName: process.env.GEMINI_MODEL_ID,
        generationConfig: { ...DEFAULT_GENERATION_CONFIG, ...additionalConfig },
    });

    return new LLMChain({
        llm,
        prompt: promptTemplate,
        memory: new BufferMemory({ memoryKey, returnMessages: false }),
        outputKey,
    });
}

function createReviewChain(context) {
    const prompt = new PromptTemplate({
        inputVariables: ['jobId', 'taskContext', 'ragContext'],
        template: `
Você é um auditor automatizado responsável por revisar as saídas geradas por agentes inteligentes.
Recebeu o contexto a seguir (incluindo tópicos RAG quando disponíveis) para o job {jobId}:

Contexto estruturado:
{taskContext}

Contexto adicional (RAG):
{ragContext}

Retorne um JSON com a estrutura:
{
  "confidenceNotes": ["justificativas sobre a consistência ou incertezas"],
  "nextSteps": ["ações recomendadas ou verificações complementares"],
  "uncertainties": ["informações ausentes que impedem uma conclusão definitiva"]
}

        Não invente respostas; se algo estiver ausente, informe claramente no campo \`uncertainties\`.
`.trim(),
    });

    return createGeminiChain(context, prompt, 'analysis_memory', 'langChainAudit');
}

function createAuditChain(context) {
    const prompt = new PromptTemplate({
        inputVariables: ['jobId', 'taskContext', 'ragContext'],
        template: `
Você é um fiscal automatizado consolidando indicadores de risco.
Use o contexto abaixo para avaliar a consistência dos dados e priorizar alertas relevantes.

Job: {jobId}
Contexto:
{taskContext}

Contexto adicional (RAG):
{ragContext}

Retorne um JSON com:
{
  "criticalFindings": ["descrições dos problemas mais relevantes"],
  "riskAreas": ["áreas com maior potencial de impacto"],
  "recommendedMitigations": ["passos práticos para mitigar os riscos identificados"]
}

Prefira instruções acionáveis e cite o trecho que motivou a conclusão.
`.trim(),
    });

    return createGeminiChain(context, prompt, 'audit_memory', 'langChainAuditFindings');
}

function createClassificationChain(context) {
    const prompt = new PromptTemplate({
        inputVariables: ['jobId', 'taskContext', 'ragContext'],
        template: `
Você é um especialista em classificação fiscal.
Baseie-se no contexto abaixo para revisar envelopes de risco e gerar recomendações.

Job: {jobId}
Contexto:
{taskContext}

Contexto adicional (RAG):
{ragContext}

Retorne um JSON com:
{
  "classificationHighlights": ["insights gerais sobre as categorias aplicadas"],
  "riskSuggestions": ["áreas onde o risco fiscal é mais elevado"],
  "dataGaps": ["informações adicionais necessárias para conclusão definitiva"]
}

Evite redundâncias e mantenha o formato JSON puro.
`.trim(),
    });

    return createGeminiChain(context, prompt, 'classification_memory', 'langChainClassification');
}

module.exports = {
    createReviewChain,
    createAuditChain,
    createClassificationChain,
};
