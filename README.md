# Nexus QuantumI2A2 – Ecossistema de Inteligência Fiscal

> Plataforma full-stack que transforma arquivos fiscais brasileiros heterogêneos em relatórios auditáveis, simulações tributárias e assistentes cognitivos com LangChain e Google Gemini como núcleos de raciocínio.

## Índice
1. [Visão geral e propósito](#visão-geral-e-propósito)  
2. [Arquitetura e fluxos](#arquitetura-e-fluxos)  
3. [Tecnologias e dependências](#tecnologias-e-dependências)  
4. [Instalação, configuração e execução](#instalação-configuração-e-execução)  
5. [Estrutura de módulos e responsabilidades](#estrutura-de-módulos-e-responsabilidades)  
6. [Integrações externas e orquestração cognitiva](#integrações-externas-e-orquestração-cognitiva)  
7. [Monitoramento, logs e métricas](#monitoramento-logs-e-métricas)  
8. [Testes e validação](#testes-e-validação)  
9. [Contribuição e licenciamento](#contribuição-e-licenciamento)

---

## Visão geral e propósito

Nexus QuantumI2A2 é um ecossistema híbrido (SPA + BFF) desenhado para automatizar auditoria fiscal, classificação e simulação tributária com adaptabilidade cognitiva. O sistema recebe arquivos fiscais (XML, PDF, CSV, DOCX, XLSX, ZIP), processa cada job por uma cadeia multiagente (extração → validação → auditoria → classificação → análise / IA → indexação) e entrega:

- Status síncrono via WebSocket e REST (`/api/jobs/:jobId/status`);  
- Dashboards interativos (Tremor + Tailwind) com métricas fiscais, simulações (`TaxSimulator`) e chat RAG com Weaviate;  
- Exportações em múltiplos formatos (SPED, EFD, CSV, ledger);  
- Auditoria cognitiva LangChain que analisa outputs da IA, enriquece relatórios e registra `langChainAudit`, `langChainAuditFindings` e `langChainClassification`.  

O backend fica responsável pela orquestração (BullMQ + EventBus), persistência (Redis / .uploads/), RAG (Weaviate) e chamadas ao Google Gemini, enquanto o frontend React/Vite oferece experiência responsiva e minimalista.

## Arquitetura e fluxos

### Diagrama lógico

```mermaid
flowchart LR
    subgraph Frontend
      F[React 18 + Vite SPA] -->|HTTP/WS| BFF[Backend-for-Frontend (Express + WebSocket)]
    end

    subgraph Backend
      BFF -->|queues| Bull[BullMQ queues]
      BFF -->|records| Redis[(Redis 7)]
      BFF -->|logs/metrics| Observability[(Logger + /metrics)]
      BFF -->|Gemini| Gemini[Google Gemini via @google/genai]
      BFF -->|uploads| Storage[.uploads/ + storageService]
      Bull --> Agents((Agentes: extraction → validation → ...))
      Agents -->|chunks/vectors| Weaviate[(Weaviate 1.24)]
      Agents -->|job state| Redis
      Agents -->|LangChain| LangChain[LangChain orchestrator]
    end

    subgraph Infra
      Redis
      Weaviate
    end

    Frontend -->|chat/export| BFF
    Frontend -->|metrics ping| Observability
    Observability -->|exposes| /metrics
```

### Fluxos principais

1. **Upload**: `FileUpload.tsx` envia arquivos para `/api/jobs`, que dispara `extractionAgent` via BullMQ.  
2. **Pipeline multiagente**: Cada etapa atualiza `redis` com status e gera artefatos (`executiveSummary`, `auditFindings`, `classifications`, `validations`).  
3. **LangChain Orchestrator**: Ao final de `analysis`, `audit` e `classification`, uma cadeia LangChain revisa os dados + contexto RAG e persiste os `langChain*`.  
4. **Dashboard**: `components/dashboard/` consome `GeneratedReport`, exibe painéis e integra `LangChainInsightsPanel`.  
5. **Chat RAG**: `/api/jobs/:jobId/chat` combina embeddings (Weaviate) e Gemini + tools para responder perguntas contextuais.  
6. **Exportação / Reconciliação**: Rotas específicas (`/api/jobs/:jobId/exports`, `/api/jobs/:jobId/reconciliation`) reutilizam dados extraídos + serviços auxiliares.

## Tecnologias e dependências

### Frontend

- **React 18.2.0** com **TypeScript**, **Vite 6.2.0** (HMR rápido).  
- **Tremor 3.17.2** e **Tailwind-inspired styles** para dashboards responsivos.  
- **@google/genai 1.28.0** para comunicação com Gemini em alguns serviços compartilhados.  
- **ws 8.18.3**, **redis 5.9.0**, **weaviate-ts-client 2.2.0** para WebSocket, cache e RAG.  
- **jszip / pdfjs-dist / tesseract.js** para manipular documentos no cliente (pré-visualização e validação local).

### Backend

- **Node.js 20+ (via package-lock)** com **Express 4.19.2** e **ws 8.17.0**.  
- **@google/genai 0.11.0** para chamadas Gemini + ferramentas (`tools.js`).  
- **LangChain 0.2.14** combinada com `@langchain/core`, `BufferMemory`, `LLMChain` e `GeminiLLM` customizado.  
- **BullMQ 5.15**, **Redis 4.6**, **Weaviate-ts-client 2.0**, **dotenv**, **uuid**, **multer**, **pdf-parse**, **sharp**, **tesseract.js** etc.  
- **Jest 29.7** e **eslint 8.57** para testes e lint.

### Infraestrutura e suporte

- **Docker Compose** (`docker-compose.yml`) garante Redis 7 e Weaviate 1.24 para dev.  
- **Start script `start-dev.sh`** limpa portas, verifica WSL2, sobe Docker e inicia backend/frontend com logs.  
- **Métricas customizadas** (prometheus-like) e rota `/metrics` via `backend/services/metrics.js`.

## Instalação, configuração e execução

### Pré-requisitos

1. **Node.js 20+** (LTS) e **npm 10+**.  
2. **Docker Engine + Docker Compose** (ou Docker Desktop) para Redis + Weaviate.  
3. **Google Gemini API key** com acesso ao modelo configurado (`GEMINI_MODEL_ID` opcional).  
4. **Ambiente POSIX/WSL2 recomendado** (script detecta WSL1 e falha).

### Passo a passo

1. **Clone o repositório**  
   ```bash
   git clone <repositório> && cd NexusQuantumI2A2-ProjetoFinal
   ```
2. **Configure variáveis de ambiente**  
   ```bash
   cp backend/.env backend/.env.local   # opcional: mantenha um backup e personalize o arquivo
   vim backend/.env
   ```  
   > Preencha `GEMINI_API_KEY`, `WEAVIATE_API_KEY`, `UPLOAD_ENCRYPTION_KEY`, `REDIS_URL`, etc., conforme seu ambiente.

#### Rotação de credenciais sensíveis

- `GEMINI_API_KEY`: chave com permissões de uso do modelo escolhido. Altere sempre que for regenerada no console da Google Cloud.  
- `WEAVIATE_API_KEY`: rotação recomendada para ambientes de homologação/prod após cada ciclo de auditoria.  
- `UPLOAD_ENCRYPTION_KEY`: qualquer valor usado por `storageService` para cifrar arquivos; mantenha em um cofre seguro e renove periodicamente.  
- `REDIS_URL` e `WEAVIATE_*`: endpoints e credenciais que apontam para infraestrutura gerenciada; renove as credenciais (usuário/senha, certificados) conforme a política de segurança do ambiente.

Recarregue o backend (`npm run dev` ou `node backend/server.js`) sempre que atualizar variáveis e evite comitar os arquivos `.env`.
3. **Instale dependências globais**  
   ```bash
   npm install          # frontend packages
   cd backend && npm install
   ```
4. **Inicie o stack completo (recomendado)**  
   ```bash
   ./start-dev.sh
   ```
   - levanta Redis + Weaviate via Docker;  
   - inicia backend (`backend/server.js`) com logs em `backend.log`;  
   - inicia Vite (`npm run dev -- --host 0.0.0.0 --port 8000`).

5. **Alternativa manual**  
   - `docker compose up -d` (após `docker-compose.yml`);  
   - `cd backend && PORT=3001 GEMINI_API_KEY=... npm run start` (ou `node server.js`);  
   - `npm run dev` no root para frontend (padrão `http://localhost:8000`).

### Build para produção

1. Gere a build do frontend: `npm run build`.  
2. Use o backend (`backend/server.js`) em produção com variáveis corretas (`NODE_ENV=production`, `GEMINI_API_KEY`, `REDIS_URL`, `WEAVIATE_*`).  
3. Ajuste supervisão (PM2, systemd, container) para rodar `node server.js`.

## Estrutura de módulos e responsabilidades

### Frontend (`src/` e `components/`)

- `App.tsx`: inicialização, pipeline tracker e troca entre upload/processamento/dashboard.  
- `/components/FileUpload`, `/PipelineTracker`, `/Header`: upload, monitoramento e ações (conciliar, exportar, alternar tema).  
- `services/**`: wrappers para API (`geminiService.ts`, `chatService.ts`), gerenciamento local (`contextMemory.ts`), auditoria (`auditorAgent.ts`).  
- `hooks/useErrorLog.ts`: centraliza report de erros para backend.  
- `components/dashboard/`: `ExecutiveAnalysis`, `TaxSimulator`, `InteractiveChat`, `LangChainInsightsPanel` e painel de auditoria.

### Backend (`backend/`)

- `server.js`: Express + WebSocket + eventos, gerencia jobs, merge de resultados e integração com LangChain & Gemini.  
- `routes/`:  
  - `jobs.js`: upload, status, chat RAG, exports, conciliação;  
  - `gemini.js`: proxy JSON;  
  - `health.js` & `metrics.js`: checkups (Redis, Weaviate, Gemini API key) e `/metrics`.  
- `services/`:  
  - `eventBus.js`, `queue.js`: orchestram BullMQ + eventos;  
  - `extractor.js`, `artifactUtils.js`, `storage.js`: pipeline de dados;  
  - `redisClient.js`, `weaviateClient.js`: conexões;  
  - `geminiClient.js`: wrapper com tools e embeddings;  
  - `logger.js`: Bunyan-like logger;  
  - `langchain/*`: `GeminiLLM`, `chains.js`, `orchestrator.js` que expõem a inteligência adaptativa (LangChain).  
- `agents/`: cada agente (`extractionAgent`, `validationAgent`, `auditAgent`, `classificationAgent`, `analysisAgent`, `indexingAgent`, `alertAgent`) escuta eventos `task:start` e emite `task:completed/failed`.
- `services/pipelineConfig.js`: carrega `pipeline.yaml` e controla controle de fluxo.

## Integrações externas e orquestração cognitiva

- **Google Gemini** via `@google/genai`: gera `executiveSummary`, atende chat RAG e alimenta LangChain.  
- **LangChain 0.2**: `GeminiLLM` e `LLMChain` revisam outputs de análise/auditoria/classificação, mantêm `BufferMemory`, registram métricas (`langchain_chain_*`) e salvam `langChain*` no Redis.  
- **Weaviate 1.24**: persiste `DocumentChunk` com embeddings para RAG e fornece contexto adicional para chat e LangChain (via `buildRagContext`).  
- **Tools** (`backend/services/tools.js`): `tax_simulation`, `cnpj_validation`, `consult_fiscal_legislation` acionadas pela IA.

## Monitoramento, logs e métricas

- Logs estruturados com contexto (módulo, job, task) em `backend/services/logger.js`; backend redireciona `stdout` para `backend.log`.  
- Métricas in-memory com formato Prometheus via `backend/services/metrics.js`; expostas em `/metrics` para scraping.  
- LangChain registra `langchain_chain_runs_total`, `langchain_chain_duration_ms`, `langchain_chain_success_total`, `langchain_chain_failure_total`.

## Testes e validação

- **Backend**: `cd backend && npm test -- <suite>` (ex.: `langchainOrchestrator`, `jobsStatus`, `health`). Usa Jest com mocks de Redis, Weaviate e Gemini.  
- **Pipeline end-to-end**: `cd backend && npm test -- pipelineE2E` simula o job completo e valida a persistência das propriedades `langChain*`.  
- **Frontend**: `npm run build` valida bundling.  
- Execute `npm run lint` no backend para validação de estilo (ESLint).  
- Para testes end-to-end manuais: suba `start-dev.sh`, faça upload de arquivos fiscais, consulte `/api/jobs/:jobId/status` e abra o dashboard em `http://localhost:8000`.

## Contribuição e licenciamento

- **Contribuições**: abra issues na raiz, siga o padrão `feat/<descrição>`, escreva testes (Jest) para novas rotinas backend e documente mudanças no README.  
- **Pull Requests**: rebase na `main`, garanta `npm run lint` e testes passando, explique `changesets` se envolver migração significativa.  
- **Licença**: MIT (veja `LICENSE`). Use, modifique e distribua livremente desde que preserve o cabeçalho.

---

## Recursos adicionais
- `pipeline.yaml`: define etapas e rótulos exibidos nos jobs.  
- `start-dev.sh`: script completo de orquestração (verifica WSL2, limpa portas, sobe Docker, inicia backend/frontend, monitora logs).  
- `backend/tests/`: exemplos de cobertura para health, rota jobs/status e orchestrator LangChain.  
- `weaviate_data/`: dados persistidos do container Weaviate para manter o índice local.
