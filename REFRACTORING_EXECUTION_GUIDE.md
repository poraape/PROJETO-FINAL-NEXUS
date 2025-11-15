# Plano de Execução Passo a Passo – NexusQuantumI2A2

## 1. Visão Geral
Este guia descreve, de forma operacional, como aplicar os planos de auditoria e refatoração já aprovados (`TECHNICAL_AUDIT_REPORT.md`, `REFACTORING_PLAN.md` e `DATA_PIPELINE_REFACTOR_PLAN.md`). O foco é transformar as recomendações em tarefas acionáveis, preservando a UI atual e limitando as mudanças visuais a otimizações e ajustes finos.

### Princípios Norteadores
- Priorizar segurança, governança de dados e resiliência do pipeline antes de evoluções cosméticas.
- Isolar ao máximo os fluxos de extração/ETL e análise para reduzir custos com LLM.
- Manter os componentes de UI existentes (`components/` e `App.tsx`) e apenas aplicar ajustes de performance, responsividade e UX incremental.
- Garantir rastreabilidade entre dados de origem (NF-e, PDFs, planilhas) e visualizações/consultas feitas no chat com RAG.

## 2. Sequenciamento Macro
1. **Fundação de Segurança e Governança (Semana 1-2)**
   - Endurecer autenticação/autorização (`backend/routes`, `backend/services/accountingAutomation.js`).
   - Blindar segredos e remover exposição da `GEMINI_API_KEY` (`vite.config.ts`, `backend/services/geminiClient.js`).
   - Revisar filas e política de retenção em Redis (`backend/services/queue.js`, `backend/services/redisClient.js`).

2. **Refatoração de Ingestão & ETL (Semana 2-4)**
   - Modularizar extratores por formato (`backend/services/extractor.impl.js`).
   - Consolidar validações e logs (`backend/services/parser.js`, `backend/services/logger.js`).
   - Criar camada de testes automáticos para ingestão (`backend/tests/`).

3. **Camada Analítica e Visualização (Semana 4-6)**
   - Implementar agregadores e armazenamento estruturado (`backend/services/reconciliation.js`, `backend/services/storage.js`).
   - Expor endpoints analíticos (`backend/routes/analytics.routes.js` – criar caso inexistente).
   - Atualizar dashboard com novos gráficos usando bibliotecas existentes (`components/dashboard/*`).

4. **Governança de Tokens e Fluxo LLM/RAG (Semana 6-7)**
   - Configurar caches, chunking e prompts padrão (`backend/services/langchainBridge.js`).
   - Validar uso de RAG com indexação incremental (`backend/services/weaviateClient.js`).
   - Ajustar camada de chat para priorizar dados pré-calculados (criar/atualizar `contexts/ChatContext.tsx` ou integrar lógica diretamente em `services/chatService.ts`).

5. **Hardening Final & Observabilidade (Semana 7-8)**
   - Revisar métricas (`backend/services/metrics.js`, `components/PipelineTracker.tsx`).
   - Documentar decisões e publicar playbooks.

## 3. Passo a Passo Detalhado

### 3.1 Segurança, Segredos e Governança
1. **Adicionar middleware de autenticação**
   - Implementar `backend/middleware/auth.js` com validação JWT/bearer (ex.: `passport`, `express-jwt`).
   - Atualizar rotas sensíveis (`backend/routes/jobs.routes.js`, `backend/routes/gemini.routes.js`) para exigir o middleware.
2. **Segmentar permissões**
   - Criar roles (ex.: `admin`, `analyst`) via claims de token.
   - Ajustar uso na UI apenas para habilitar/ocultar ações (ex.: `components/Header.tsx` para botões restritos) sem alterar layout.
3. **Gerir segredos**
   - Remover injeção de `GEMINI_API_KEY` do bundle (`vite.config.ts` → ler de backend via endpoint seguro).
   - Adicionar `.env.example` com variáveis mínimas.
4. **Políticas de retenção**
   - Configurar TTL nas keys do Redis (`backend/services/redisOptions.js`).
   - Criar job periódico em `backend/services/accountingAutomation.js` para limpeza de artefatos antigos.

### 3.2 Ingestão de Dados Multi-formato
1. **Refatorar extratores**
   - Dividir `extractor.impl.js` em submódulos: `extractors/xml`, `extractors/pdf`, `extractors/csv`.
   - Utilizar bibliotecas open source: `fast-xml-parser`, `pdf-parse`, `papaparse`.
2. **Pipeline de validação**
   - Criar esquema mínimo por formato (`backend/services/schemas/nfe.schema.json`).
   - Implementar sanitização de encoding com `iconv-lite`.
   - Registrar erros/avisos em `backend/services/logger.js` com níveis e correlação por upload.
3. **Testes automatizados**
   - Adicionar fixtures em `backend/tests/fixtures/` com NF-e UTF-8/ISO-8859-1, CSV com campos faltantes etc.
   - Escrever testes Jest para cada extrator (`backend/tests/extractor.spec.js`).

### 3.3 Transformação, Armazenamento e Métricas
1. **Normalização e schema único**
   - Criar módulo `backend/services/normalizer.js` para mapear campos críticos (CFOP, cliente, valores).
   - Persistir dados estruturados em coleção (Mongo/Postgres) ou manter no Redis com hashes.
2. **Agregadores off-LLM**
   - Implementar funções com `pandas` via `node-python` ou preferencialmente `duckdb-wasm`/`arquero` para agregação local.
   - Exemplos: total por período, por CFOP, por cliente.
3. **Serviço de analytics**
   - Criar `backend/services/analyticsService.js` com endpoints REST (`GET /analytics/summary`, `/analytics/timeseries`, `/analytics/by-cfop`).
   - Garantir cache incremental usando Redis (`backend/services/artifactCache.js`).

### 3.4 Dashboard e UI (Ajustes Finos)
1. **Reutilizar componentes existentes**
   - Atualizar `components/dashboard/MetricCard.tsx`, `NfeTrendChart.tsx` e `TaxChart.tsx` para consumir novos endpoints via `services/analyticsClient.ts` (criar se necessário).
   - Adicionar gráficos com `react-chartjs-2` ou `recharts` (verificar dependências atuais antes de incluir novas). Caso precise incluir biblioteca, optar por opção leve.
2. **Garantir responsividade**
   - Revisar `components/ReportDisplay.tsx` e `components/dashboard` para evitar reflow. Utilizar CSS flex/grid existente.
3. **Perf e UX**
   - Implementar memoization no `contexts/DashboardContext.tsx` (criar) usando `useMemo` para evitar renders.
   - Lazy load de gráficos via `React.lazy` se necessário.

### 3.5 RAG, Chat Interativo e Economia de Tokens
1. **Indexação estruturada**
   - Após normalização, indexar documentos com metadados (`backend/services/weaviateClient.js`).
   - Usar IDs de NF-e, período, cliente como filtros.
2. **Fluxo de consulta**
   - No `contexts/ChatContext.tsx` (ou camada equivalente em `services/chatService.ts`), orquestrar consulta: primeiro query aos agregadores; se precisar, buscar RAG; somente depois chamar LLM para sumarização.
   - Implementar caching de prompts/respostas com `artifactCache`.
3. **Governança de tokens**
   - Definir prompts padrão em `backend/services/langchainBridge.js` com instruções de concisão.
   - Utilizar chunking de 1k tokens + overlap 100 com `langchain`.
   - Registrar consumo em `backend/services/metrics.js`.

### 3.6 Observabilidade e QA
1. **Dashboards técnicos**
   - Integrar logs com Stackdriver/ELK ou usar `pino` + `pino-pretty`.
   - Criar painéis em `components/PipelineTracker.tsx` para status.
2. **CI/CD**
   - Configurar pipelines (GitHub Actions) para rodar lint, testes e deploy staging.
3. **Documentação**
   - Atualizar `README.md`, `DEPLOY.md` (criar) e registrar playbooks por etapa.

## 4. Prioridades e Quick Wins
- **Quick Wins (Semana 1)**: proteção de segredos, middleware de auth, logs estruturados, TTL em Redis.
- **Médio Prazo (Semana 2-4)**: modularização de extratores, testes automatizados, endpoints analytics.
- **Alto Impacto (Semana 4-6)**: dashboard com gráficos, caching de análises, governaça de tokens.
- **Estratégico (Semana 6-8)**: RAG robusto, observabilidade completa, CI/CD maduro.

## 5. Ganhos Esperados
- **Performance**: agregações off-LLM reduzem latência do chat em 40-60% e diminuem custo de tokens em até 70% para perguntas recorrentes.
- **Confiabilidade**: validação multi-formato e testes automatizados reduzem erros de ingestão em 80%.
- **Escalabilidade**: filas com TTL e cache analítico suportam 3x volume atual de NF-e sem degradação.
- **Governança**: rastreabilidade ponta a ponta (extração → analytics → resposta) garante compliance fiscal.
- **Economia de Tokens**: chunking, cache e reuso de prompts limitam uso de LLM às etapas interpretativas.

## 6. Dependências e Riscos
- Disponibilidade de acesso às bases (Redis, banco analítico).
- Necessidade de provisionar storage durável caso ainda inexistente.
- Compatibilidade das bibliotecas open source com Node 20.
- Treinamento da equipe para lidar com pipeline RAG/token metrics.

## 7. Checklist Final por Release
- [ ] Autenticação aplicada em todas as rotas sensíveis.
- [ ] Logs estruturados com correlação de upload.
- [ ] Extratores e normalizadores versionados e testados.
- [ ] Endpoints analíticos com cache e documentação.
- [ ] Dashboard atualizado, sem regressões visuais.
- [ ] Chat integrado ao RAG com referência aos dados consultados.
- [ ] Observabilidade e CI/CD em operação.

