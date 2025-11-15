// backend/services/weaviateClient.js
const fs = require('fs');
const weaviateModule = require('weaviate-ts-client');
const logger = require('./logger').child({ module: 'weaviateClient' });
const weaviate = weaviateModule.default ?? weaviateModule;

function resolveEndpoint() {
    const envUrl = process.env.WEAVIATE_URL;
    if (envUrl) {
        try {
            const parsed = new URL(envUrl);
            const scheme = parsed.protocol.replace(':', '');
            const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
            return { scheme, host };
        } catch (error) {
            logger.warn('[Weaviate] WEAVIATE_URL inválida. Usando variáveis individuais.', { envUrl, error });
        }
    }
    const scheme = process.env.WEAVIATE_SCHEME || 'http';
    const host = process.env.WEAVIATE_HOST || 'localhost:8080';
    return { scheme, host };
}

function configureTls(scheme) {
    if (scheme !== 'https') return;

    const caFile = process.env.WEAVIATE_TLS_CA_FILE;
    if (caFile) {
        if (fs.existsSync(caFile)) {
            process.env.NODE_EXTRA_CA_CERTS = caFile;
            logger.info('[Weaviate] Certificado raiz customizado configurado.', { caFile });
        } else {
            logger.warn('[Weaviate] Arquivo CA informado não existe.', { caFile });
        }
    }

    const rejectUnauthorized = process.env.WEAVIATE_TLS_REJECT_UNAUTHORIZED !== 'false';
    if (!rejectUnauthorized) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        logger.warn('[Weaviate] Validação TLS desabilitada. Use apenas em ambientes de desenvolvimento.');
    }
}

const { scheme, host } = resolveEndpoint();
const forceTls = process.env.WEAVIATE_FORCE_TLS === 'true';
if (forceTls && scheme !== 'https') {
    throw new Error('[Weaviate] WEAVIATE_FORCE_TLS habilitado, porém o endpoint não usa HTTPS.');
}
configureTls(scheme);
const apiKeyValue = process.env.WEAVIATE_API_KEY;

const clientOptions = { scheme, host };
if (apiKeyValue) {
    const ApiKey = weaviateModule.ApiKey || weaviate.ApiKey;
    clientOptions.apiKey = new ApiKey(apiKeyValue);
}

const client = weaviate.client(clientOptions);

const className = 'DocumentChunk';

async function setupSchema() {
    try {
        const schema = await client.schema.getter().do();
        const classExists = schema.classes.some(c => c.class === className);

        if (!classExists) {
            logger.info('[Weaviate] Schema não encontrado. Criando class DocumentChunk.');
            const schemaConfig = {
                'class': className,
                'description': 'Um trecho de um documento fiscal',
                'properties': [
                    { 'name': 'jobId', 'dataType': ['text'] },
                    { 'name': 'fileName', 'dataType': ['text'] },
                    { 'name': 'content', 'dataType': ['text'] },
                ]
            };
            await client.schema.classCreator().withClass(schemaConfig).do();
            logger.info('[Weaviate] Schema "DocumentChunk" criado com sucesso.');
        } else {
            logger.info('[Weaviate] Schema "DocumentChunk" já existe.');
        }
    } catch (error) {
        logger.error('[Weaviate] Falha ao configurar o schema.', { error });
        // Se o Weaviate não estiver rodando, isso pode falhar. A aplicação continuará, mas a indexação não funcionará.
    }
}

setupSchema();

module.exports = { client, className };
