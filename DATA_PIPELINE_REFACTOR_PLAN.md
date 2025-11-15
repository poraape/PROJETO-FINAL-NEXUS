Plano de Refatoração Técnica – Pipeline Fiscal NexusQuantumI2A2
================================================================

Introdução
----------
O backend atual (`backend/server.js`, `services/extractor.js`, `services/dataGovernance.js`) já oferece upload com `multer`, cache em Redis e indexação em Weaviate, enquanto o frontend (`components/dashboard`, `services/chatService.ts`) consome relatórios sintéticos gerados pela LLM. O relatório de auditoria e o plano geral anterior expuseram riscos na robustez de extração, ausência de validação fiscal estruturada, dependência excessiva da LLM para análises básicas e falta de governança sobre uso de tokens. Este plano especializado detalha como evoluir o pipeline de dados fiscais com ferramentas open source, garantindo ingestão resiliente a múltiplos formatos/encodings, análises determinísticas de baixo custo e experiências interativas orientadas por RAG.

Roteiro Detalhado de Refatoração
---------------------------------

1. Fortalecer Ingestão Multiformato e Observabilidade no Extrator
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Separar `services/extractor.js` em módulos (`services/extractor/ingestController.js`, `services/extractor/parsers/*.js`, `services/extractor/ocr.js`) mantendo o `extractor.js` como façade exportada para `routes/upload` e `services/pipelineConfig.js`.

Passo 2: Integrar detecção de encoding com `chardet` + `iconv-lite`, aplicando fallback automático antes de `bufferToString` e registrando encoding final no metadado persistido em Redis (`artifactCache.storeArtifact`).

Passo 3: Substituir parsing genérico por bibliotecas especializadas e stream-friendly: `fast-xml-parser` para NF-e XML, `yauzl` para ZIPs, `pdf-parse` + `pdf2json` para PDFs, `csv-parse` para CSV/TSV e `node-unzipper` para lotes; centralizar retries e limites em `runWithConcurrency` usando `p-queue` com `FILE_EXTRACTION_CONCURRENCY`.

Passo 4: Implementar sanitização e preenchimento de campos faltantes com `@json2csv/plainjs` e `ajv` (schema minimalista) antes de enviar chunks para RAG, registrando erros de campo via `services/logger` com `severity='warn'` e anexando contexto em `artifactCache` para revisão posterior.

Passo 5: Criar suíte de testes em `backend/tests/extractor.spec.js` validando cenários: XML UTF-8/ISO-8859-1, CSV com separador `;`, PDFs com OCR obrigatório (`tesseract.js`) e arquivos corrompidos (verificar que o job é marcado com `status='partial'` e mensagem descritiva).

Racional Técnico

A separação modular aumenta coesão e facilita a substituição de parsers; encoding detection evita perda de caracteres; parsers especializados melhoram performance e confiabilidade; validação mínima impede lixo na camada analítica. Segue princípios SOLID (Single Responsibility), OWASP File Upload Security (capítulo V10) e garante rastreabilidade por logs estruturados.

Avanços Esperados

Cobertura consistente de arquivos fiscais heterogêneos, detecção antecipada de falhas e maior confiança nos dados disponibilizados para análise e RAG.

Impactos e Benefícios Mensuráveis

+40% de redução em falhas de parsing (via testes), latência média de extração < 1.5x arquivos texto, 100% das falhas reportadas com stack rastreável. Token usage zero nesta etapa (100% off-LLM).

2. Normalização Fiscal e Orquestração ETL Determinística
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Criar módulo `services/transform/nfeNormalizer.js` consumindo o output do extrator para consolidar chaves NF-e (emitente, destinatário, CFOP, itens, tributos) com `fast-xml-parser` e `cpf-cnpj-validator`, utilizando schemas `ajv` em `config/schemas/nfe.schema.json` para validações obrigatórias.

Passo 2: Enriquecer dados com tabelas auxiliares (`services/fiscalRulesService.js`, `services/brasilAPI.js`) para mapear CST/CSOSN, alíquotas e códigos de município, persistindo dataset estruturado em DuckDB (`services/storage.js` -> `analysis/analysis.db`) com tabelas `nfe_header`, `nfe_items`, `tax_totals`.

Passo 3: Registrar ETL jobs em `services/metrics.js` com métricas Prometheus (`etl_records_total`, `etl_records_invalid_total`) e gerar relatório de qualidade em `artifactCache` com lista de documentos descartados + motivo.

Passo 4: Criar testes de integração `backend/tests/nfeNormalizer.spec.js` cobrindo NF-e parcial, campos faltantes, divergências de CFOP, garantindo que itens inválidos sejam isolados e anotados para revisão.

Racional Técnico

Uma camada ETL determinística separa preocupações entre ingestão e análise, reduzindo dependência da LLM e permitindo agregações confiáveis. Validação com `ajv` e enriquecimento com regras locais seguem princípios Data Quality (Timeliness, Accuracy) e LGPD (minimização via descarte de dados inválidos).

Avanços Esperados

Dataset relacional consistente pronto para consultas SQL e visualizações, melhora rastreabilidade de inconsistências fiscais.

Impactos e Benefícios Mensuráveis

Cobertura de 99% dos campos essenciais de NF-e, backlog de inconsistências visível, base única para RAG. Tokens ainda não utilizados (off-LLM).

3. Motor Analítico de Baixo Custo com DuckDB/Polars
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Introduzir serviço `services/analysisEngine.js` que utiliza `duckdb` (ou `nodejs-polars` se preferir DataFrames) para executar queries materializadas sobre o banco local `analysis.db`, expondo funções `getFiscalSummary`, `getTaxBreakdown`, `getTrendSeries`.

Passo 2: Criar rotas REST `routes/analytics.js` (`GET /analytics/summary`, `GET /analytics/trend`, `GET /analytics/breakdown`) protegidas por autenticação (seguindo plano base) e conectadas ao motor analítico.

Passo 3: Implementar camada de cache Redis (`redisClient`) com chave composta (`jobId:analytics:summary:v{schemaVersion}`) e invalidação no final do ETL (`eventBus.emit('etl:completed')`).

Passo 4: Disponibilizar métricas agregadas (total NF-e, impostos, volume por período/cliente/produto/CFOP) e consultas paramétricas (período, CNPJ, CFOP) usando prepared statements para prevenir SQL injection.

Passo 5: Adicionar testes `backend/tests/analysisEngine.spec.js` simulando dataset pequeno e conferindo agregações e filtros.

Racional Técnico

DuckDB/Polars são open source e fornecem consultas in-memory otimizadas sem custos recorrentes, permitindo respostas determinísticas e rápidas. O cache evita reprocessamento e mantém custo operacional baixo.

Avanços Esperados

Camada de análise consistente, com respostas sub-200ms para consultas comuns e base confiável para dashboards e chat.

Impactos e Benefícios Mensuráveis

Redução de 80% nas chamadas à LLM para métricas básicas, tempo de resposta das APIs analíticas < 300ms P95, economia de tokens estimada em 60%.

4. Dashboard Dinâmico com Visualizações Determinísticas
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Atualizar `services/chatService.ts` e `services/contextMemory.ts` para consumir as novas rotas `/analytics`, preenchendo `GeneratedReport.metrics` com dados reais em vez de valores mockados.

Passo 2: Refatorar componentes `components/dashboard/NfeTrendChart.tsx`, `TaxChart.tsx`, `ChatChart.tsx` para ler dados via hooks (`hooks/useAnalytics.ts`) que chamam o backend com SWR/React Query, exibindo série temporal (linha/área) e gráfico adicional (barras por CFOP, pizza por imposto) usando `@tremor/react` + `d3-scale` (open source).

Passo 3: Criar componente `components/dashboard/AggregatedTable.tsx` com tabela paginada (DataGrid open source como `mantine-datatable` ou `react-table`) mostrando totais por cliente/produto com filtros (período, CFOP, status).

Passo 4: Implementar fallback para dados inconsistentes (exibir aviso) e logging de frontend via `useErrorLog` quando API retornar lacunas.

Passo 5: Adicionar testes de renderização (React Testing Library) para garantir que gráficos usam dados reais e filtros atualizam resultados.

Racional Técnico

Visualizações baseadas em dados determinísticos entregam clareza imediata sem custo de tokens; atualização incremental melhora UX e reduz necessidade de narrativas repetitivas da LLM.

Avanços Esperados

Dashboard confiável com métricas auditáveis, visão temporal real e gráficos estratégicos prontos para reuniões executivas.

Impactos e Benefícios Mensuráveis

Tempo de obtenção de insights reduzido em 70%, eliminação de discrepâncias entre chat e dashboard, aumento de adoção interna.

5. Governança de Tokens e Layer Cognitiva Enxuta
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Criar módulo `services/llmUsageController.js` interceptando chamadas do `langchainBridge` e `geminiClient`, adicionando política de roteamento: (a) queries resolvidas por `/analytics` → resposta determinística; (b) apenas perguntas interpretativas ou explicativas são encaminhadas à LLM.

Passo 2: Atualizar `langchain/orchestrator.js` para incluir cabeçalho de contexto com resumo analítico pré-calculado (output do motor analítico) e reduzir `maxTokens`/`temperature`, mantendo `MAX_CHUNK_SIZE` coerente com agregações.

Passo 3: Implementar cache semântico em Redis (`llm:jobId:hash(question)`) com TTL e armazenamento do ID da consulta analítica que originou a resposta, reaproveitando resultados repetidos.

Passo 4: Definir pontos 100% off-LLM: upload, parsing, ETL, analytics endpoints, dashboard, filtros; Pontos com LLM: sumarização executiva (`executiveSummary`), insights estratégicos, explicações narrativas e sugestões de hipóteses.

Passo 5: Documentar estratégia de chunking/compressão (`contexts/` + `services/pipelineConfig.js`) descrevendo como agregações são sintetizadas antes de chegar ao prompt (tabelas → JSON compactado, top-N insights), reduzindo chamadas redundantes.

Racional Técnico

Limitar a LLM às tarefas de alto valor reduz custos e riscos de alucinação. Cache e roteamento determinístico seguem boas práticas de AI Engineering e Token Governance.

Avanços Esperados

Uso consciente de tokens com foco em explicabilidade, mantendo consistência com dados persistidos.

Impactos e Benefícios Mensuráveis

Economia projetada de 65% em tokens mensais, menor latência de respostas, histórico auditável de decisões.

6. Chat Exploratória com Drill-down Determinístico e RAG Transparente
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Etapas Práticas de Implementação

Passo 1: Estender `components/dashboard/InteractiveChat.tsx` para incluir comandos guiados (botões de filtro) que chamam diretamente as rotas `/analytics`, exibindo tabelas/gráficos inline (sem LLM) antes de oferecer interpretação.

Passo 2: Atualizar `services/chatService.ts` para executar queries estruturadas (SQL parametrizado via `/analytics`) com base nos filtros solicitados; apenas após retorno determinístico enviar resumo à LLM para descrição opcional.

Passo 3: Reforçar RAG criando `services/rag/indexer.js` responsável por gravar chunks formatados (`analysisContext` + referência NF-e) em Weaviate com metadados (`jobId`, `nfeId`, `cfop`, `periodo`), acionado após ETL.

Passo 4: Ajustar `langchainBridge` para incluir na resposta IDs das fontes (`sourceDocumentIds`) e disponibilizar no chat (link “ver fonte”), garantindo rastreabilidade.

Passo 5: Implementar cache de conversas estruturadas em `artifactCache` para consultas repetidas, invalidando quando novo lote for carregado.

Racional Técnico

Chat deve priorizar respostas baseadas em dados concretos antes de narrativa LLM, alinhando-se à estratégia RAG e evitando divergências entre camadas.

Avanços Esperados

Usuários conseguem explorar dados completos com filtros ricos, mantendo confiança na origem factual e reduzindo dependência de prompts manuais.

Impactos e Benefícios Mensuráveis

Aumento de 50% na precisão percebida das respostas (por survey interno), queda de 40% em perguntas repetidas ao suporte, latência média < 2s com caching ativado.

Entregas Parciais & Estratégia de Implementação
-----------------------------------------------
- Release 1 (Quick Wins): Itens 1 e 2. Necessitam apenas de backend e testes automatizados; habilitam ingestão robusta e dataset confiável para as próximas etapas.
- Release 2: Item 3 em paralelo com criação das rotas `/analytics`; depende da normalização concluída. Entregar junto com métricas Prometheus e cache Redis.
- Release 3: Item 4 (frontend) consumindo APIs prontas; pode ser desenvolvido em branch separado `feature/dashboard-analytics` com testes de UI.
- Release 4: Itens 5 e 6 consolidando governança de tokens, cache e melhorias no chat/RAG; requer coordenação com DevOps para monitoramento de custos e invalidadores de cache.

Branches temporárias sugeridas: `feat/extractor-refactor`, `feat/nfe-etl`, `feat/analytics-engine`, `feat/dashboard-insights`, `feat/llm-governance`. Cada branch deve passar por pipeline CI com `npm test` backend/frontend.

Dependências: Item 3 depende do 2; Itens 4-6 dependem dos dados estruturados (Item 2/3) e dos endpoints publicados.

Modularização Sugerida
----------------------
- Extração (`services/extractor/*`, `services/storage.js`): ingestão multiformato, OCR, encode detection.
- Transformação (`services/transform/*`, `config/schemas/*`): validação, enriquecimento fiscal, persistência relacional.
- Análise (`services/analysisEngine.js`, `routes/analytics.js`, `services/metrics.js`): consultas determinísticas, cache Redis, exposição REST.
- Visualização (`hooks/useAnalytics.ts`, `components/dashboard/*`): dashboard, tabelas e gráficos sincronizados.
- Camada LLM (`services/llmUsageController.js`, `langchain/*`, `services/geminiClient.js`): sumarização, insights, governança de tokens.
- Camada RAG (`services/rag/indexer.js`, `services/weaviateClient.js`, `artifactCache.js`): indexação, recuperação contextual, rastreabilidade.

Prioridades de Implementação
----------------------------
- Quick Wins: Modularização do extrator (Item 1), validação mínima NF-e (Item 2 Passos 1-3), cache Redis para analytics (Item 3 Passo 3).
- Alto Impacto: Motor analítico (Item 3 completo), Dashboard real (Item 4), Governança de tokens (Item 5).
- Estratégico Longo Prazo: Chat com drill-down e RAG transparente (Item 6) e métricas de experiência.

Gains Funcionais e Estruturais Esperados
----------------------------------------
- Performance: consultas sub-300ms, ingestão paralela escalável, dashboards atualizados em tempo quase real.
- Confiabilidade: validação e logging estruturado reduzem falhas silenciosas; rastreabilidade NF-e → resposta.
- Escalabilidade: DuckDB/Polars suportam volumes > milhões de linhas em máquina única; modularização facilita distribuição por workers.
- Governança de Dados: schemas versionados, métricas Prometheus, logs auditáveis, referências cruzadas no RAG.
- Economia de Tokens: LLM reservada para insights > redução combinada de ~60-65% no consumo mensal.

Tabela-Resumo de Refatoração
----------------------------
| Item de Refatoração | Prioridade | Esforço | Impacto Esperado | Área Afetada |
| --- | --- | --- | --- | --- |
| Fortalecer ingestão multiformato e observabilidade | Alta | Média | Parsing robusto, falhas reduzidas, zero tokens | Backend (Extração) |
| Normalização fiscal e ETL determinística | Alta | Alta | Dados consistentes, base relacional para análises | Backend (Transformação) |
| Motor analítico com DuckDB/Polars e cache | Alta | Alta | Métricas confiáveis em baixa latência, -80% LLM | Backend (Análise) |
| Dashboard dinâmico com dados reais | Média | Média | Visualizações auditáveis, +insights executivos | Frontend |
| Governança de tokens e camada cognitiva enxuta | Alta | Média | -65% tokens, respostas consistentes | Backend (LLM) |
| Chat com drill-down determinístico e RAG transparente | Média | Média | Exploração rica, fontes rastreáveis | Frontend + Backend (RAG) |

Considerações Finais
--------------------
A execução escalonada deste plano moderniza o pipeline fiscal sem depender de serviços pagos além da infraestrutura existente. O uso disciplinado de bibliotecas open source (DuckDB, Polars, Tremor, ajv, iconv-lite) garante custos previsíveis, enquanto a modularização permite evolução contínua. Após cada release, recomenda-se monitorar métricas (`etl_records_invalid_total`, `analytics_query_duration_ms`, `llm_tokens_consumed`) e revisar políticas de cache/RAG para manter consistência com a base fiscal. O plano está pronto para ser inserido no backlog, priorizado por squads e acompanhado com rituais ágeis, mantendo foco em performance, confiabilidade e economia de tokens.
