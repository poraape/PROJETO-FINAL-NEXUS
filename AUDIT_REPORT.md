# Auditoria Técnica — Nexus QuantumI2A2

## 1. Sumário da análise técnica
- **Arquitetura:** o repositório expõe um SPA React/Vite (`App.tsx`, `components/`, `hooks/`, `services/`) que se comunica com um BFF Node/Express (`backend/server.js`) via HTTP e WebSocket. O backend orquestra um pipeline multiagente com filas BullMQ (cada agente reside em `backend/agents/*.js`) e armazena estado no Redis (`backend/services/redisClient.js`), artefatos no disco (`backend/services/storage.js`) e vetores no Weaviate (`backend/services/weaviateClient.js`). O frontend usa `config.ts` para derivar URLs do BFF e mantém memória contextual/localStorage em `contexts/contextMemory.ts`, enquanto serviços como `services/geminiService.ts` providenciam chamadas à proxy Gemini.
- **Dependências chaves:** `@google/genai`, `bullmq`, `redis`, `weaviate-ts-client`, `ws`, `tesseract.js`, `sharp`, `pdf-parse` e várias bibliotecas para parsing (`xlsx`, `mammoth`, `jszip`). Todas estão divididas entre `package.json` raiz (aplicação SPA) e `backend/package.json` (BFF/agentes). O uso de promessas, WebSocket, filas e contextos compartilhados sustenta a coerência entre camadas.
- **Integração e camadas:** o frontend envia arquivos via `/api/jobs` e consome estado em tempo real via WebSocket (`backend/server.js:135-220`). Os agentes reagem a `eventBus` e manipulam o estado do pipeline/resultado através de `redis`, garantindo que cada etapa (extração, validação, auditoria, classificação, IA, indexação) receba dados encadeados declarados em `backend/pipeline.yaml`. O backend também expõe chat RAG, exportações e conciliação por meio das rotas em `backend/routes/*.js`.
- **Coesão lógica:** o conjunto de serviços auxiliares (e.g., `services/artifactUtils.js`, `services/extractor.js`, `services/tools.js`) mantém responsabilidades delimitadas, embora seja necessário reforçar o encapsulamento entre o Orquestrador (`server.js`) e os agentes (p. ex., gerenciamento de payloads).
- **Observabilidade e estabilidade:** métricas básicas (`backend/services/metrics.js`) e logs estruturados acompanham requests e WebSockets, mas ainda é necessário reforçar alertas/telemetria para filas e tempo de execução dos agentes. Limpeza de arquivos não é bloqueante (`storage.js`) e existe desligamento gracioso no servidor (`backend/server.js:300-340`).
- **Testabilidade isolada:** o arquivo `services/extractor.js` agora encapsula a lógica pesada em `extractor.impl.js` e só carrega esse módulo fora de testes; quando `NODE_ENV === 'test'` ele exporta `extractor.mock.js`, que simula artefatos e evita dependências nativas como `pdf-parse`, `sharp` e `tesseract`. Isso acelera a inicialização das suítes e permite que o backend seja carregado mesmo em ambientes restritos.

## 2. Problemas identificados e causas
| Problema | Causa raiz | Impacto | Severidade |
| --- | --- | --- | --- |
| O orquestrador dispara a próxima etapa duas vezes | `eventBus.on('task:completed')` chama `startTask(jobId, nextTask, payload)` e em seguida `startTask(jobId, nextTask, nextPayload)` sem esperar o primeiro terminar (`backend/server.js:242-255`). | Cada etapa do pipeline pode ser enfileirada e executada duas vezes, gerando duplicação de trabalho, sobrecarga no Redis/queues e resultados inconsistentes (o mesmo job pode emitir dois estados “completado” para a mesma etapa). | Alta |
| Testes de integração não iniciam no ambiente restrito | O sandbox impede que o servidor HTTP / `Supertest` subam sockets (`listen EPERM` ao tentar vincular 0.0.0.0/127.0.0.1), então as suítes abortam antes de alcançar qualquer validação. | `npm test` sempre falha no primeiro request, impossibilitando o CI de garantir regressões e obrigando a equipe a confiar apenas em verificações manuais. | Alta |
| Ausência de fallback do pipeline ao chamar ferramentas | O flux de `analysisAgent` aciona `eventBus.emit('tool:run')`, mas o Orquestrador não confirma que o resultado já foi reencaminhado antes de continuar, o que pode deixar o job em “aguardando” se `tool:completed` for perdido ou falhar silenciosamente. | Jobs ficam presos na etapa `analysis`, gerando timeout/perda de estado. | Média |

## 3. Sugestões de correção e otimização
1. **Corrigir o salto duplicado do pipeline** — remova a primeira chamada `startTask` e passe apenas `nextPayload` para a próxima etapa, garantindo que cada tarefa seja enfileirada uma vez. Isso reduz a carga em BullMQ e evita discrepâncias nos indicadores de pipeline (`backend/server.js:242-255`). Prioridade: crítica.
2. **Permitir testes sem abrir sockets** — o ambiente bloqueia `server.listen` em 0.0.0.0/127.0.0.1. Para contornar, injete uma camada de mock de `Supertest` ou um helper que chama `app.handle` diretamente (sem `http`/`net`), e documente a necessidade de executar os testes em ambientes com permissões de rede quando for indispensável usar sockets reais. Prioridade: alta.
3. **Fortalecer o orquestrador de ferramentas** — valide que o evento `tool:run` retorna um success/failure para o agent (adicionar timeout/retries), para não travar a etapa `analysis` quando uma ferramenta falha silenciosamente (`backend/agents/analysisAgent.js:1-120`). Prioridade: média.
4. **Instrumentar filas e workers** — exponha métricas de latência/concurrency (por exemplo, contadores para cada fila do `backend/services/queue.js` e `eventBus`) e registre timestamps em `job.result`, ajudando a identificar gargalos e variações de desempenho. Prioridade: média.
5. **Padronizar configuração local** — documente/automatize `.env.example` com chaves `GEMINI_API_KEY`, `REDIS_URL`, `WEAVIATE_HOST` e instruções para rodar o stack (`docker-compose.yml` + `start-dev.sh`) para garantir coerência entre equipes. Prioridade: média/baixa.

## 4. Resultados dos testes realizados / roteiro recomendado
- **Comando executado:** `cd backend && npm test`
  - Resultado: **falha nos hooks de inicialização.** Mesmo com o extractor substituído por um mock, o sandbox impede que o servidor abra um socket (`listen EPERM` ao tentar vincular 0.0.0.0/127.0.0.1) e o `supertest` aborta antes de processar qualquer rota. Os testes não conseguem validar o backend nesta infraestrutura.
- **Próximos passos recomendados para validar a base:**
  1. Reimplemente os testes de integração para trabalhar sem `Supertest`/`superagent` abrindo sockets (por exemplo, chamando `app.handle` diretamente ou usando um mock de rede), mantendo o stub de `extractor` em `NODE_ENV === 'test'`.
  2. Rode `cd backend && npm test` em um ambiente com permissão para abrir sockets (ex.: CI com portas liberadas ou VM local com rede habilitada) para confirmar que os endpoints respondem como esperado.
  3. No frontend, execute `npm run build` na raiz para garantir que o Vite embale todos os componentes e fail early caso existam imports inválidos.
  4. Automatize a verificação de lint (`npm run lint` no backend e no frontend, se adicionados) e inclua smoke tests (upload + chat + exportação) numa stack real (`docker-compose` rodando Redis/Weaviate/Gemini ou seus mocks) antes de liberar versões.

## 5. Recomendações de manutenção contínua e aprimoramento futuro
- **Monitoramento contínuo:** exporte as métricas internas (`metrics.formatPrometheus()`) para um endpoint real (Prometheus + Grafana) e monitore latências de filas, uso de tokens do Gemini e taxa de falhas em `eventBus`.
- **Revisão periódica de dependências pesadas:** `pdf-parse`, `sharp`, `tesseract.js` e `@google/genai` são potenciais vetores de consumo de memória. Estabeleça uma cadência mensal para atualizar e revisar breaking changes, especialmente para o Gemini SDK.
- **Auditoria de segurança e privacidade:** garanta que o `GEMINI_API_KEY` não seja exposto em logs; traceamento atual (logs `console.log`) deve evoluir para um logger com níveis/rotas estruturadas. Centralize a rotação de chaves e crie alertas ao detectar erros críticos do `handleError` global.
- **Documentação viva do pipeline:** mantenha um diagrama atualizado (mermaid fum) e a `pipeline.yaml` sincronizada com o código dos agentes; isso aumenta a confiabilidade ao adicionar novos passos ou ferramentas e evita a duplicação detectada no `task:completed`.
- **Testes e QA contínuos:** integre testes end-to-end (upload + chat + exportação) no CI, preferencialmente usando containers que simulam Redis/Weaviate/Gemini (via mocks). Isso garante que o sistema “rode liso” como esperado após cada alteração.
- **Requisitos de ambiente documentados:** registre as permissões de rede necessárias (ou a falta delas) para rodar o backend em testes locais, incluindo como executar as suítes em máquinas que não permitem abrir sockets e quando é preciso usar mocks diretos como `extractor.mock.js`.

## 6. Plano consolidado de consolidação técnica

### Arquitetura & agentes
- **Pipeline único:** mantenha `backend/server.js` invocando `startTask` apenas uma vez por etapa e faça com que cada agente consuma os payloads fundidos (`payload`, `resultPayload`, `mergedContext`) vindos do Redis, evitando execuções duplicadas e preservando o histórico (`job` salvo em `job:${jobId}`).
- **Core LangChain real:** `backend/services/langchainClient.js` consolida `ChatGoogleGenerativeAI`, `ConversationBufferMemory` e `WeaviateStore`, expondo `runAnalysis` e `runChat` usados diretamente pelo `analysisAgent` e pelas rotas de chat; o fallback `langchainBridge` agora só faz cache auxiliar e telemetria.
- **Mock de extractor para testes:** faça com que `backend/services/extractor.js` decida entre `extractor.impl.js` e `extractor.mock.js` de acordo com `NODE_ENV`, de modo que `backend` carregue sem instalar binários pesados durante `npm test`.
- **Ferramentas resilientes:** refatore `backend/agents/analysisAgent.js` para aplicar timeouts/retries antes de emitir `tool:run`, garantindo que falhas ou travamentos em LangChain/Gemini façam o job migrar para `failed` após o tempo limite definido.

### Pipeline & comunicação
- **Blueprint LangChain:** mapeie cada agente para uma cadeia/ferramenta LangChain usando `ConversationBufferMemory` + `VectorStoreRetriever` (Weaviate) e faça o `eventBus` enriquecer cada atualização com metadados contextuais (hash, origem, timestamp) para preservar contratos de API existentes.
- **Sincronização full-stack:** padronize as respostas HTTP e payloads de WebSocket para incluir hashes de contexto e meta como `contextHash`, `lastUpdatedAt`, `sourceStep`, permitindo ao frontend detectar dados obsoletos sem alterar o visual do tracker.

### Performance & observabilidade
- **Métricas de fila:** adicione contadores e histogramas em `backend/services/queue.js` e nos agentes (`toolInvocationsTotal`, `jobLatencyMs`, `analysisFailuresTotal`) seguindo formato Prometheus, e exponha `/metrics` para scraping sob demanda.
- **Cache semântico:** aproveite o cache das cadeias LangChain (por exemplo, `LLMChain` com cache habilitado) e mantenha o histórico hierárquico de `job → conversa → documento`, reutilizando vetores guardados no Weaviate para reduzir tokens por execução.

### Inicialização & testes CI
- **Startup segura:** estenda a rota `/api/health` para checar readyness do Redis, Weaviate, Gemini e ferramentas LangChain; só ligue o servidor após todas as conexões estarem confirmadas e registre diagnósticos detalhados em cada etapa.
- **Testes não bloqueantes:** mantenha os polyfills mínimos (`backend/jest.setup.js`), evite sobrescrever `http.Server.listen` e faça os testes chamar `app.handle` quando necessário, garantindo que `npm test` passe em ambientes sem permissões de socket e que as métricas não registrem erros `EPERM`.

### Documentação & governança
- **Relatório vivo:** atualize `AUDIT_REPORT.md` com decisões arquiteturais (LangChain, mock extractor, métricas, guardrails) e documente dependências críticas (`LangChain`, `BullMQ`, `Weaviate`, `Redis`) com licenças/custos previstos.
- **Changelog incremental:** associe cada melhoria (mock extractor, bloqueio de ferramentas, métricas) a uma entrada específica no changelog para rastrear evolução e referenciar a fase do plano na descrição do commit.

### Critérios de validação
- As etapas concluídas devem possuir métricas mensuráveis: pipeline com um `startTask` por step; `npm test` concluindo sob `NODE_ENV=test`; novas métricas visíveis em `/metrics`; cache reduzindo tokens repetidos; job updates com hashes + metadata; LangChain retornando contexto extra nas respostas (sem quebrar UI).
- Execute `npm run build` na raiz para garantir que o frontend corresponde às mudanças de metadados; teste upload + dashboard para garantir que o tracker visual permanece inalterado enquanto detalha o contexto expandido.
