Plano de Refatoração Técnica – NexusQuantumI2A2-ProjetoFinal
=============================================================

Introdução
----------
O relatório técnico identificou vulnerabilidades críticas de segurança (exposição da `GEMINI_API_KEY`, ausência de autenticação nas rotas e WebSocket, proxy Gemini aberto), riscos de compliance (armazenamento e transporte sem criptografia), gargalos operacionais (jobs sem TTL, cache ilimitado, processamento de embeddings não otimizado) e dívidas de manutenção (acoplamento a singletons, validação frágil das respostas da IA, dependências duplicadas). Este plano transforma essas constatações em um roteiro executável e priorizado para recuperar segurança, resiliência operacional e governança do código.

Roteiro Detalhado de Refatoração
---------------------------------

1. Implementar Autenticação e Autorização End-to-end para Jobs e WebSocket
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Definir modelo de identidade (JWT assinado pelo backend com `sub`, `orgId`, escopos) e armazenar secret/keys em `backend/config/security.js` consumindo variáveis `JWT_PUBLIC_KEY`/`JWT_PRIVATE_KEY`.

Passo 2: Criar middleware `requireAuth` em `backend/middleware/auth.js` validando assinatura, expiração e associação do `jobId` ao `sub/orgId` (usar Redis hash `job:{id}:meta`).

Passo 3: Aplicar `requireAuth` às rotas `backend/routes/jobs.js` (`GET /:jobId/status`, `GET /:jobId/export`, `POST /` etc.) e adicionar verificação de propriedade antes de retornar payloads.

Passo 4: Atualizar handshake do WebSocket em `backend/server.js` para exigir token via query/header e rejeitar conexões inválidas (`ws.handleUpgrade` com verificação assíncrona do middleware).

Passo 5: Criar testes de integração com Supertest e ws simulando acessos autenticados vs. não autenticados (`npm run test:backend`).

Racional Técnico

Elimina IDOR, aplica princípio de menor privilégio e garante segregação multi-tenant. Baseado em OWASP ASVS 4.0 (V2 – autenticação) e V3 (gerenciamento de sessões).

Avanços Esperados

Blindagem de relatórios e uploads; acesso limitado a proprietários legítimos; suporte a auditoria de acesso.

Impactos e Benefícios Mensuráveis

Redução de 100% das leituras não autorizadas detectáveis, conformidade com LGPD/GDPR; possibilidade de instrumentar métricas `auth_failures_total`.

2. Remover Chave Gemini do Frontend e Criar BFF Seguro
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Excluir `define({ GEMINI_API_KEY: ... })` do `vite.config.ts` e remover uso direto em `App.tsx`.

Passo 2: Criar rota autenticada `/api/reports` no backend que encapsula chamadas Gemini (`backend/routes/reports.js`), reutilizando `sharedContext.model`.

Passo 3: Atualizar `services/geminiService.ts` para consumir apenas esta rota usando `fetch` com token Bearer proveniente do login.

Passo 4: Armazenar segredo via Secret Manager/Kubernetes Secret e expor ao backend através de `process.env.GEMINI_API_KEY` com validação de presence no bootstrap.

Passo 5: Cobrir com teste de contrato (msw no frontend simulando BFF) garantindo que nenhuma referência direta à chave permaneça (`npm run test`).

Racional Técnico

Segrega responsabilidades: backend mantém segredos; frontend torna-se cliente de API confiável. Segue boas práticas de secret management e Zero Trust.

Avanços Esperados

Prevenção total de vazamento da chave; reforço das quotas e monitoramento centralizado.

Impactos e Benefícios Mensuráveis

Redução imediata do risco de abuso de crédito de IA; elimina exposição direta da chave (>10^6 requisições potencialmente maliciosas evitadas).

3. Endurecer Proxy Gemini com Rate Limiting e Auditoria
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Adicionar middleware `rateLimit` (ex.: `express-rate-limit` com armazenamento Redis) configurado por usuário/IP (ex.: 60 req/min).

Passo 2: Exigir escopo específico (`scope.includes('gemini:invoke')`) no token antes de chamar a API.

Passo 3: Registrar métricas Prometheus (`gemini_proxy_requests_total`, `gemini_proxy_blocked_total`) e logs estruturados em `backend/services/logger.js`.

Passo 4: Implementar fila opcional (BullMQ) para cargas grandes, persistindo eventos em Redis para auditoria.

Passo 5: Criar testes de estresse (k6 ou artillery) garantindo throttling esperado antes do deploy.

Racional Técnico

Mitiga DoS financeiro e abuso de API paga; aplica OWASP API Security Top 10 (API4 – Lack of Resources & Rate Limiting).

Avanços Esperados

Controle de quotas, rastreabilidade de uso e bloqueio de abuso automatizado.

Impactos e Benefícios Mensuráveis

Limita consumo a 60 req/min/usuário, reduzindo risco de custos inesperados em >90%; logs permitem SLA/chargeback.

4. Introduzir TTL e Políticas de Retenção em Redis para Jobs e Cache RAG
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Parametrizar `JOB_RETENTION_SECONDS` e `CHAT_CACHE_TTL_SECONDS` no `config.ts`.

Passo 2: Ao finalizar o job (`queue.on('completed')`), chamar `redis.expire('job:${id}:*', JOB_RETENTION_SECONDS)`.

Passo 3: Refatorar gravação do cache de chat para utilizar `redis.set(key, value, { EX: ttl, NX: false })` e limitar tamanho com `LTRIM`/`ZREMRANGEBYRANK`.

Passo 4: Criar script cron (BullMQ repeatable job) para purgar entradas antigas e anonimizar campos sensíveis.

Passo 5: Monitorar consumo com métrica `redis_memory_usage_bytes` exposta via `/metrics`.

Racional Técnico

Evita retenção indefinida de dados sensíveis, melhora escalabilidade horizontal. Segue princípios de data minimization (LGPD) e boas práticas de cache.

Avanços Esperados

Consumo previsível de Redis, remoção automática de dados antigos, alinhamento a políticas de retenção.

Impactos e Benefícios Mensuráveis

Expectativa de redução de >70% no footprint de memória em ambientes persistentes; elimina vazamentos históricos.

5. Atualizar e Unificar SDK Gemini no Backend
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Atualizar `backend/package.json` para `@google/generative-ai@^1.28.0` e remover dependência do frontend.

Passo 2: Refatorar `backend/services/geminiClient.js` para nova API (utilizar `GoogleGenerativeAI` + `GenerativeModel`).

Passo 3: Ajustar chamadas em `routes/jobs.js` e novos endpoints para refletir assinaturas atualizadas (promises, streaming).

Passo 4: Implementar contrato TypeScript (`types/gemini.ts`) compartilhado via `tsconfig` paths.

Passo 5: Rodar suíte de regressão (unit + integração) para garantir compatibilidade, e configurar `npm run audit` pós-atualização.

Racional Técnico

Elimina divergência de SDKs, reduz superfície de ataque duplicada e possibilita patches de segurança recentes.

Avanços Esperados

Padronização das chamadas Gemini, centralização de controle e simplificação do bundle frontend.

Impactos e Benefícios Mensuráveis

Redução de ~400 kB no bundle; menor risco de incompatibilidades; facilita auditoria única de dependências.

6. Tornar Criptografia e TLS Obrigatórios para Armazenamento e Serviços Externos
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Validar presença de `UPLOAD_ENCRYPTION_KEY` ao iniciar o servidor; abortar bootstrap se ausente em `NODE_ENV=production`.

Passo 2: Atualizar `backend/services/storage.js` para exigir AES-GCM com IV único, armazenando `salt`/`tag` junto ao arquivo.

Passo 3: Configurar `backend/services/redisClient.js` e `weaviateClient.js` para consumir URLs `rediss://`/`https://` via variáveis obrigatórias; habilitar verificação de certificado (`tls: { rejectUnauthorized: true }`).

Passo 4: Documentar instruções no README e `.env.example` (ver item 10).

Passo 5: Executar testes de integração com containers TLS (`docker-compose` com Redis TLS) garantindo conectividade.

Racional Técnico

Cumpre requisitos de confidencialidade e integridade em trânsito e repouso; alinha-se a OWASP ASVS V9 (Data Protection).

Avanços Esperados

Proteção de documentos sensíveis e resiliência contra MITM; habilitação para auditorias de compliance.

Impactos e Benefícios Mensuráveis

Risco de vazamento físico reduzido drasticamente; logs de verificação de certificado previnem configurações inseguros.

7. Refatorar Serviços Frontend para Validação Tipada e Armazenamento Abstrato
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Introduzir schemas Zod (`zod`) para parse das respostas Gemini (`ReportSchema`, `ActionItemSchema`).

Passo 2: Dividir `generateReportFromFiles` em funções puras menores (`mapGeminiChunks`, `mergeSummaries`, `buildExecutiveSummary`).

Passo 3: Criar interface `MemoryProvider` com implementações `LocalStorageProvider` e `InMemoryProvider` para testes.

Passo 4: Adicionar limpeza automática (`pruneOlderThan`) e limites de tamanho; usar compressão opcional (LZ-string) para reduzir footprint.

Passo 5: Escrever testes com Vitest garantindo validação de schema, limites e comportamento offline.

Racional Técnico

Aplica princípios SOLID (SRP, DIP) e melhora confiabilidade ao validar contratos da IA.

Avanços Esperados

Menos erros em runtime, possibilidade de reuso dos serviços em ambientes SSR/testes.

Impactos e Benefícios Mensuráveis

Cobertura de testes ↑ para >70% dos serviços; redução de bugs de parsing relatados; melhora no TTI por armazenar menos dados.

8. Otimizar Processamento de Embeddings e Cache de Respostas
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Implementar batching real (`for (const batch of chunked(chunks, BATCH_SIZE)) await model.batchEmbedContents(batch)`) respeitando limites da API.

Passo 2: Persistir embeddings em Redis ou banco persistente com chave composta (`embedding:{docId}:{chunkId}`) para reuso.

Passo 3: Adicionar circuit breaker/Retry com `p-retry` para lidar com throttling.

Passo 4: Instrumentar métricas (`embedding_latency_seconds`, `cache_hit_ratio`).

Passo 5: Rodar benchmark (scripts em `scripts/loadtest-embeddings.mjs`) comparando latência antes/depois.

Racional Técnico

Reduz latência e consumo de quota; alinhado a boas práticas de pipelines RAG.

Avanços Esperados

Menor tempo de processamento para lotes grandes; melhora no SLA de entrega de relatórios.

Impactos e Benefícios Mensuráveis

Expectativa de redução de até 40% no tempo total do job e aumento de cache hit rate >60%.

9. Centralizar Logging Estruturado e Sanitização
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Introduzir logger (pino ou winston) compartilhado no backend e frontend (modo development) com níveis (`info`, `warn`, `error`).

Passo 2: Substituir `console.log` em `App.tsx` e serviços por chamadas ao logger com masking de dados sensíveis.

Passo 3: Configurar transporte opcional para SIEM (HTTP/Fluentd) em produção.

Passo 4: Criar utilitário de redaction (`redactKeys(['apiKey','token'])`).

Passo 5: Cobrir com testes unitários garantindo que logs não vazem chaves.

Racional Técnico

Melhora observabilidade, remove logs sensíveis, aplica princípio de confidencialidade mínima.

Avanços Esperados

Logs consistentes, prontos para monitoramento; risco de vazamento reduzido.

Impactos e Benefícios Mensuráveis

Redução de 100% dos logs com dados sensíveis; aderência a ISO 27001 controle A.12.4.

10. Documentar Hardening e Criar `.env.example`
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Adicionar seção "Operação Segura" ao README com instruções de TLS, autenticação, rotação de chaves e limites.

Passo 2: Criar `.env.example` contendo variáveis obrigatórias (`JWT_PRIVATE_KEY`, `UPLOAD_ENCRYPTION_KEY`, `REDIS_URL`, etc.).

Passo 3: Atualizar script `start-dev.sh` para alertar quando variáveis críticas estiverem ausentes.

Passo 4: Validar documentação com revisão cruzada (PR review checklist).

Passo 5: Publicar guia interno (wiki) com checklist de produção.

Racional Técnico

Reduz falhas de configuração e alinhamento às recomendações do relatório (DX + segurança).

Avanços Esperados

Onboarding mais seguro, menor risco de ambientes inseguros.

Impactos e Benefícios Mensuráveis

Queda de incidentes de configuração; diminuição do tempo de setup em ~30%.

11. Automatizar Auditoria de Dependências e Pipeline de Qualidade
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Criar workflow GitHub Actions `security-audit.yml` rodando `npm audit --production`, `npx snyk test` (se disponível) e `npm outdated`.

Passo 2: Adicionar job de lint/test paralelos (`npm run lint`, `npm run test`) com matriz frontend/backend.

Passo 3: Configurar badge no README exibindo status do workflow.

Passo 4: Definir política de bloqueio (merge require passing audit).

Passo 5: Revisar mensalmente relatórios e documentar na wiki.

Racional Técnico

Integra DevSecOps contínuo, detectando CVEs e regressões cedo.

Avanços Esperados

Visibilidade contínua sobre vulnerabilidades; prevenção de regressões.

Impactos e Benefícios Mensuráveis

Tempo de resposta a CVE reduzido para <24h; melhoria de confiabilidade do build.

12. Podar Dependências Frontend e Modularizar Rotas Backend
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Remover pacotes não usados no navegador (`redis`, `ws`); avaliar divisão lazy de libs pesadas (dynamic import para `tesseract.js`).

Passo 2: Usar `vite-bundle-visualizer` para validar queda de bundle.

Passo 3: No backend, dividir `backend/routes/jobs.js` em módulos (`uploadsRouter`, `chatRouter`, `exportsRouter`) compartilhando middlewares comuns.

Passo 4: Adicionar testes unitários por módulo e rotas isoladas.

Passo 5: Atualizar documentação e importações para refletir nova organização.

Racional Técnico

Reduz complexidade e melhora performance de carregamento. Aplica SRP e prepara o backend para crescimento modular.

Avanços Esperados

Bundle inicial menor, rotas mais fáceis de manter/testar.

Impactos e Benefícios Mensuráveis

Meta de reduzir bundle inicial em >25%; queda da complexidade cognitiva (medida via `plato` ou `ts-prune`).

Entregas Parciais & Estratégia de Implementação
-----------------------------------------------
- **Release 1 (Semana 1)**: Itens 1 e 2 em paralelo (exigem coordenação). Requer branch `feature/security-hardening` e revisão dedicada.
- **Release 2 (Semanas 2-3)**: Itens 3, 4 e 6 após autenticação disponível; dependem das mesmas estruturas de configuração.
- **Release 3 (Semanas 4-5)**: Itens 5, 8 e 12 para estabilizar pipeline RAG e modularidade (requer branch `feature/rag-optimization`).
- **Release 4 (Semanas 6-7)**: Itens 7, 9 e 10 voltados à qualidade, DX e documentação; podem ocorrer em paralelo após refatorações estruturais.
- **Release 5 (Contínuo)**: Item 11 rodando na pipeline principal, alimentando monitoramento contínuo.

Dependências Lógicas
- Item 1 (auth) é pré-requisito para 2 e 3.
- Item 4 (TTL) depende da infraestrutura Redis segura (Item 6).
- Item 5 deve ocorrer antes de 2 para remover SDK do frontend.

Recomendações de Branches/MVPs
- Criar branches temáticos por release, com feature flags (`ENABLE_NEW_AUTH`) para permitir deploy incremental.
- Utilizar canary (ambiente staging) para validar rate limiting e batching antes do merge final.

Tabela-Resumo de Refatoração
-----------------------------

| Item de Refatoração | Prioridade | Esforço | Impacto Esperado | Área Afetada |
| --- | --- | --- | --- | --- |
| Autenticação e autorização end-to-end | Alta | Alta | Segurança ↑↑, conformidade LGPD | Backend/API |
| Backend-only Gemini + remoção da chave | Alta | Média | Segredos protegidos, custo controlado | Frontend/Backend |
| Rate limiting e auditoria do proxy Gemini | Alta | Média | Prevenção de abuso, rastreabilidade | Backend/Security |
| TTL e retenção em Redis | Média | Média | Escalabilidade ↑, memória ↓ | Infra/Backend |
| SDK Gemini unificado e atualizado | Média | Média | Estabilidade ↑, riscos ↓ | Backend/Dependências |
| Criptografia e TLS obrigatórios | Alta | Média | Proteção de dados sensíveis | Infra/Security |
| Validação tipada e storage abstrato no frontend | Média | Média | Bugs ↓, testabilidade ↑ | Frontend |
| Otimização de embeddings e cache | Média | Média | Performance ↑, custos ↓ | Backend/RAG |
| Logging estruturado e sanitizado | Média | Baixa | Observabilidade ↑, vazamentos ↓ | Full Stack |
| Guia de hardening + `.env.example` | Média | Baixa | DX seguro ↑, erros de config ↓ | Documentação |
| Auditoria de dependências automática | Alta | Baixa | Detecção rápida de CVEs | DevOps |
| Podar dependências frontend + modularizar rotas | Média | Média | Bundle ↓, manutenibilidade ↑ | Front/Back |

Considerações Finais
--------------------
A execução disciplinada deste plano mitiga vulnerabilidades críticas, fortalece a governança de dados e prepara o pipeline RAG para escala controlada. Monitoramento contínuo (itens 3, 4, 11) deve ser mantido após as entregas para prevenir regressões. Recomenda-se revisão trimestral da segurança e performance com base nas métricas implantadas e ajustes no roadmap conforme surgirem novos requisitos regulatórios ou de negócios.

Documento pronto para integração no backlog, acompanhamento em sprint e comunicação técnica ao time.
