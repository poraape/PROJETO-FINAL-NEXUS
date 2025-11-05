// backend/agents/extractionAgent.js

const JSZip = require('jszip');
const { extractText } = require('../services/parser');

function register({ eventBus, updateJobStatus }) {
    eventBus.on('task:start', async ({ jobId, taskName, payload }) => {
        if (taskName !== 'extraction') return;

        try {
            const { files } = payload;
            await updateJobStatus(jobId, 0, 'in-progress', `Descompactando e lendo ${files.length} arquivo(s)...`);
            
            const fileContentsForAnalysis = [];
            for (const file of files) {
                if (file.mimetype === 'application/zip') {
                    const zip = await JSZip.loadAsync(file.buffer);
                    for (const fileName in zip.files) {
                        if (!zip.files[fileName].dir) {
                            const textContent = await extractText(await zip.files[fileName].async('nodebuffer'), fileName);
                            fileContentsForAnalysis.push({ fileName, content: textContent });
                        }
                    }
                } else {
                    const textContent = await extractText(file.buffer, file.mimetype, file.originalname);
                    fileContentsForAnalysis.push({ fileName: file.originalname, content: textContent });
                }
            }
            await updateJobStatus(jobId, 0, 'completed');
            eventBus.emit('task:completed', { jobId, taskName, resultPayload: { fileContentsForAnalysis }, payload });
        } catch (error) {
            eventBus.emit('task:failed', { jobId, taskName, error: `Falha na extração: ${error.message}` });
        }
    });
}

module.exports = { register };