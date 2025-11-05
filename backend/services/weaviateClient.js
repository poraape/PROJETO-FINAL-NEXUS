// backend/services/weaviateClient.js
const weaviateModule = require('weaviate-ts-client');
const weaviate = weaviateModule.default ?? weaviateModule;

const client = weaviate.client({
    scheme: 'http',
    host: 'localhost:8080',
});

const className = 'DocumentChunk';

async function setupSchema() {
    try {
        const schema = await client.schema.getter().do();
        const classExists = schema.classes.some(c => c.class === className);

        if (!classExists) {
            console.log('[Weaviate] Schema não encontrado. Criando...');
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
            console.log('[Weaviate] Schema "DocumentChunk" criado com sucesso.');
        } else {
            console.log('[Weaviate] Schema "DocumentChunk" já existe.');
        }
    } catch (error) {
        console.error("[Weaviate] Falha ao configurar o schema:", error);
        // Se o Weaviate não estiver rodando, isso pode falhar. A aplicação continuará, mas a indexação não funcionará.
    }
}

setupSchema();

module.exports = { client, className };
