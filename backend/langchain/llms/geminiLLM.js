const { LLM } = require('@langchain/core/language_models/llms');
const logger = require('../../services/logger').child({ module: 'langchain/GeminiLLM' });

class GeminiLLM extends LLM {
    constructor({ geminiModel, modelName, generationConfig = {}, verbose }) {
        super({ verbose });
        if (!geminiModel) {
            throw new Error('GeminiLLM requires a valid Gemini model instance.');
        }
        this.geminiModel = geminiModel;
        this.modelName = modelName || process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';
        this.defaultGenerationConfig = generationConfig;
    }

    _llmType() {
        return 'gemini';
    }

    invocationParams() {
        return { model: this.modelName };
    }

    async _call(prompt, options = {}) {
        const normalizedPrompt = this.normalizePrompt(prompt);
        const generationConfig = {
            ...(this.defaultGenerationConfig || {}),
            ...(options?.generationConfig || {}),
        };

        try {
            const result = await this.geminiModel.generateContent({
                contents: [
                    {
                        parts: [
                            {
                                text: normalizedPrompt,
                            },
                        ],
                    },
                ],
                generationConfig,
            });

            const response = await result.response;
            return response.text?.() || '';
        } catch (error) {
            logger.error('[LangChain] Falha ao chamar Gemini pelo LangChain:', { error: error?.message || error });
            throw error;
        }
    }

    normalizePrompt(prompt) {
        if (typeof prompt === 'string') {
            return prompt;
        }
        if (prompt?.toString && typeof prompt.toString === 'function') {
            return prompt.toString();
        }
        return JSON.stringify(prompt);
    }
}

module.exports = { GeminiLLM };
