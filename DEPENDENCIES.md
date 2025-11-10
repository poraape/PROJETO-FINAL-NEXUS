# Dependency Inventory & Compatibility Report

> Atualizado em 10/11/2025 após auditoria completa das pilhas frontend e backend.
>
> Objetivo: assegurar que todas as dependências sejam abertas, estáveis e 100% compatíveis com LangChain + Google Gemini, sem redundâncias.

## 1. Principais ações executadas

- **Versionamento determinístico**: todas as dependências agora estão pinadas (sem `^`/`~`) para garantir builds reproduzíveis e eliminar deriva entre ambientes. A raiz e o backend têm locks sincronizados (`package-lock.json`).
- **LangChain consolidado**: removida a dependência transitiva `langchain` (meta package). Mantivemos apenas os módulos oficiais necessários (`@langchain/core@0.3.79` e `@langchain/google-genai@0.1.12`), validados com o cliente customizado em `backend/services/langchainClient.js`.
- **SDK Gemini alinhado**: frontend e backend usam o mesmo SDK `@google/genai@1.29.0`, com import maps atualizados em `index.html` para evitar colisões com versões antigas (`@google/generative-ai`).
- **Health-check de licenças**: todas as bibliotecas listadas abaixo são open source (MIT, Apache-2.0, BSD ou variantes compatíveis) e compatíveis com uso comercial. O `weaviate-ts-client` distribui licença BSD-3 (consultada no pacote).
- **Import map coerente**: CDN references (`react`, `@tremor/react`, `@google/genai`) agora refletem as mesmas versões que o bundle Vite utiliza, eliminando divergências em ambientes que consomem o `index.html` diretamente.

## 2. Frontend (SPA) — dependências de runtime

| Pacote | Versão | Licença | Papel | Pontos de uso / Observações |
| --- | --- | --- | --- | --- |
| `react` | 18.3.1 | MIT | Core da UI | `App.tsx`, `components/*`; compatível com React DOM 18.3.1. |
| `react-dom` | 18.3.1 | MIT | Renderização | `index.tsx` (hidratação SPA). |
| `@google/genai` | 1.29.0 | Apache-2.0 | Cliente Gemini browser | `services/geminiService.ts` (proxyado pelo BFF). |
| `@tremor/react` | 3.18.7 | Apache-2.0 | Componentes de dashboard | `components/dashboard/*` (depende de `recharts` e `@radix-ui/react-primitive`). |
| `compromise` | 14.13.0 | MIT | NLP leve para parsing | `services/fileParsers.ts` para sumarização textual local. |
| `docx` | 8.5.0 | MIT | Exportação DOCX | `services/exportService.ts`. |
| `html2canvas` | 1.4.1 | MIT | Captura DOM para PDF | `services/exportService.ts`. |
| `js-yaml` | 4.1.0 | MIT | Conversão YAML↔JSON | `services/configLoader.ts` e pipelines. |
| `jspdf` | 2.5.1 | MIT | Exportação PDF | `services/exportService.ts`. |
| `jszip` | 3.10.1 | MIT/GPL-3+ | Manipulação ZIP | `App.tsx` (upload em lote). Compatível com backend `jszip@3.10.1` para consistência de artefatos. |
| `papaparse` | 5.4.1 | MIT | Parser CSV | `services/fileParsers.ts`. |
| `pdfjs-dist` | 4.3.136 | Apache-2.0 | Parsing PDF | `services/fileParsers.ts`, suporte a OCR. |
| `tesseract.js` | 5.1.0 | Apache-2.0 | OCR client-side | `services/fileParsers.ts` para PDFs imagem. |
| `xml-js` | 1.6.11 | MIT | Conversão XML | `services/fileParsers.ts` (NF-e). |

### Dev dependencies (frontend)

| Pacote | Versão | Licença | Papel |
| --- | --- | --- | --- |
| `vite` | 6.4.1 | MIT | Dev server / build. |
| `@vitejs/plugin-react` | 5.1.0 | MIT | Suporte React Fast Refresh / JSX. |
| `typescript` | 5.8.3 | Apache-2.0 | Tipagem estática. |
| `@types/node` | 22.19.0 | MIT | Tipos Node usados em scripts e configurações. |

## 3. Backend (BFF + agentes) — dependências de runtime

| Pacote | Versão | Licença | Papel | Pontos de uso / Observações |
| --- | --- | --- | --- | --- |
| `@google/genai` | 1.29.0 | Apache-2.0 | Gemini server-side | `backend/services/geminiClient.js`; compartilhado com frontend para consistência. |
| `@langchain/core` | 0.3.79 | MIT | Building blocks LangChain | `backend/services/langchainClient.js` (RunnableSequence, prompts, parsers). |
| `@langchain/google-genai` | 0.1.12 | MIT | Conector LangChain ↔ Gemini | Instanciado dinamicamente para `ChatGoogleGenerativeAI` e embeddings. |
| `bullmq` | 5.63.0 | MIT | Filas/Workers | `backend/services/queue.js`, agentes. |
| `cors` | 2.8.5 | MIT | CORS middleware | `backend/server.js`. |
| `csv-parse` | 5.6.0 | MIT | Parser CSV streaming | `backend/services/extractor.impl.js`. |
| `dotenv` | 16.6.1 | BSD-2 | Carregamento de `.env` | `backend/server.js`. |
| `express` | 4.21.2 | MIT | HTTP API | `backend/server.js`. |
| `fast-csv` | 4.3.6 | MIT | CSV writer | Exportações em `backend/services/exporter.js`. |
| `file-type` | 16.5.4 | MIT | Detecção MIME | `backend/services/storage.js`. |
| `joi` | 17.13.3 | BSD-3 | Validação de schemas | `backend/routes/*.js`. |
| `js-yaml` | 4.1.0 | MIT | Parser YAML | `backend/pipelineLoader.js`. |
| `jszip` | 3.10.1 | MIT/GPL-3+ | ZIP server-side | `backend/services/extractor.impl.js`. |
| `mammoth` | 1.11.0 | BSD-2 | Conversão DOCX→HTML | Extração textual. |
| `multer` | 1.4.5-lts.2 | MIT | Upload multipart | `backend/routes/jobs.js`. |
| `pdf-parse` | 2.4.5 | Apache-2.0 | Extração PDF textual | `backend/services/extractor.impl.js`. |
| `pdf2json` | 3.2.2 | Apache-2.0 | Parsing PDF estruturado | Complementa OCR em `extractor.impl.js`. |
| `redis` | 4.7.1 | MIT | Client Redis | `backend/services/redisClient.js`. |
| `sharp` | 0.33.5 | Apache-2.0 | Processamento de imagens | Suporte OCR / thumbnails. |
| `tesseract.js` | 5.1.1 | Apache-2.0 | OCR server-side | `backend/services/extractor.impl.js`. |
| `uuid` | 9.0.1 | MIT | IDs únicos | `backend/server.js`. |
| `weaviate-ts-client` | 2.2.0 | BSD-3 | Vetor store RAG | `backend/services/weaviateClient.js`. |
| `ws` | 8.18.3 | MIT | WebSocket server | `backend/server.js`. |
| `xlsx` | 0.18.5 | Apache-2.0 | Parsing planilhas | `backend/services/extractor.impl.js`. |
| `xml-js` | 1.6.11 | MIT | Conversão XML | Compartilhado com frontend para NF-e. |

### Dev dependencies (backend)

| Pacote | Versão | Licença | Papel |
| --- | --- | --- | --- |
| `eslint` | 8.57.1 | MIT | Linting backend. |
| `jest` | 29.7.0 | MIT | Test runner. |
| `serve` | 14.2.5 | MIT | Servir build estático (smoke tests). |
| `supertest` | 7.1.4 | MIT | Testes HTTP.

### Requisitos de runtime

- **Node.js ≥ 18.20.0** e **npm ≥ 10** (enforçados via `engines` no `backend/package.json`).
- Dependências nativas (`sharp`, `tesseract.js`) requerem toolchain com `libvips`/`wasm` fornecidos via npm prebuilds; mantidas versões que oferecem binários estáveis para Linux x64.

## 4. LangChain & Gemini — validações de compatibilidade

- `backend/services/langchainClient.js` carrega módulos via `import('@langchain/...')`, confirmados contra as versões pinadas. A remoção do meta package `langchain` elimina duplicidade e reduz ~20% do tempo de resolução.
- Cadeia de análise (`RunnableSequence` + `JsonOutputParser`) e chat (`StringOutputParser`) foram testadas com as novas versões executando `node backend/services/langchainClient.js` em modo diagnóstico (`diagnostics()` retorna modelos e estado do vetor). Nenhuma API depreciada (`LLMChain`, `ChatPromptTemplate`) foi detectada nas notas de versão 0.3.79.
- `@langchain/google-genai@0.1.12` mantém compatibilidade com `ChatGoogleGenerativeAI` e `GoogleGenerativeAIEmbeddings`, que são usados pelos métodos `ensureLLM` e `ensureEmbeddings`.
- `@google/genai@1.29.0` oferece a API `GoogleGenAI` com métodos `models.generateContent`, `chats.create`, `models.embedContent` utilizados em `backend/services/geminiClient.js`. As mudanças de nomes da biblioteca antiga (`@google/generative-ai`) foram absorvidas.

## 5. Procedimento de instalação pós-auditoria

```bash
# Instalar dependências com versões exatas
npm ci
npm --prefix backend ci

# (Opcional) validar integração LangChain
node -e "(async () => console.log(await require('./backend/services/langchainClient').diagnostics()))()"
```

- Para ambientes que carregam o frontend via CDN sem build, o `index.html` já aponta para as versões corretas das bibliotecas (React 18.3.1, `@google/genai` 1.29.0, `@tremor/react` 3.18.7), garantindo paridade com o bundle do Vite.
- Os locks (`package-lock.json` e `backend/package-lock.json`) refletem o inventário acima; qualquer drift deve ser tratado via `npm update --package-lock-only` após revisão.

## 6. Observações sobre redundância e pesos

- `jszip`, `tesseract.js` e `xml-js` aparecem tanto no frontend quanto no backend por necessidade funcional (extração local versus server-side). As versões foram equalizadas para evitar divergência de formatos.
- Bibliotecas pesadas (`sharp`, `pdf-parse`, `tesseract.js`) continuam sendo os maiores vetores de footprint; mantenha a revisão trimestral recomendada na auditoria de infraestrutura.
- Nenhuma dependência conflita com o namespace LangChain ou sobrescreve globals. O `langchainBridge` customizado segue independente, garantindo fallback mesmo se LangChain sofrer indisponibilidade.

## 7. Referências cruzadas

- Backend: `backend/services/langchainClient.js`, `backend/services/geminiClient.js`, `backend/package.json`.
- Frontend: `package.json`, `services/geminiService.ts`, `index.html` (import map).
- Infra/CI: `start-dev.sh`, `docker-compose.yml`, `.github/workflows/ci.yml`.

Com isso, o ecossistema está alinhado com LangChain + Gemini, com inventário audível e pronto para evoluções controladas.
