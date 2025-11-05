// backend/routes/gemini.js
const express = require('express');
const router = express.Router();

module.exports = (context) => {
    const { model } = context;

    // --- Endpoint Proxy ---
    router.post('/', async (req, res) => {
        const { promptParts, isJsonMode } = req.body;

        if (!promptParts || !Array.isArray(promptParts)) {
            return res.status(400).json({ message: "O corpo da requisição deve conter 'promptParts'." });
        }

        console.log(`[BFF-GeminiProxy] Recebida requisição para Gemini. Modo JSON: ${isJsonMode}`);

        try {
            const generationConfig = isJsonMode ? { responseMimeType: 'application/json' } : undefined;
            
            const result = await model.generateContent({
                contents: [{ parts: promptParts }],
                generationConfig,
            });

            const response = await result.response;
            const text = response.text();
            
            res.status(200).json({
                text: text,
                candidates: response.candidates, 
            });
        } catch (error) {
            console.error("[BFF-GeminiProxy] Erro ao chamar a API Gemini:", error);
            res.status(500).json({ 
                message: `Erro no servidor ao processar a requisição da IA: ${error.message}`,
                details: error.toString(),
            });
        }
    });

    return router;
};