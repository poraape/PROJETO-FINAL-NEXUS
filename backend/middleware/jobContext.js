const logger = require('../services/logger').child({ module: 'jobContext' });

function withJobContext(redisClient) {
    return async function jobContextMiddleware(req, res, next) {
        const { jobId } = req.params;
        if (!jobId) {
            return res.status(400).json({ message: 'Parâmetro jobId é obrigatório.' });
        }
        try {
            const jobString = await redisClient.get(`job:${jobId}`);
            if (!jobString) {
                return res.status(404).json({ message: 'Job não encontrado.' });
            }
            try {
                req.jobRecord = JSON.parse(jobString);
            } catch (error) {
                logger.error('[JobContext] Falha ao parsear o job armazenado.', { jobId, error: error.message });
                return res.status(500).json({ message: 'Falha ao recuperar o job solicitado.' });
            }
            req.jobRecordId = jobId;
            return next();
        } catch (error) {
            logger.error('[JobContext] Falha ao recuperar job.', { jobId, error: error.message });
            return res.status(500).json({ message: 'Erro interno ao buscar o job.' });
        }
    };
}

module.exports = {
    withJobContext,
};
