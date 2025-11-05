# Nexus QuantumI2A2 - Ecossistema de Inteligência Fiscal

**Nexus QuantumI2A2** é uma plataforma de inteligência fiscal que transforma documentos tributários complexos em insights acionáveis. Utilizando um sistema multi-agente orquestrado por um backend robusto e a API Google Gemini, a plataforma automatiza o processamento, validação e análise de uma vasta gama de arquivos fiscais brasileiros, entregando relatórios interativos, simulações e um assistente de IA contextual.

---

## 🚀 Principais Funcionalidades

A plataforma opera com uma arquitetura de **análise em camadas**, permitindo que o usuário comece com uma visão geral rápida e aprofunde a investigação sob demanda.

#### 1. **Processamento Assíncrono e Inteligente de Arquivos**
- **Amplo Suporte a Formatos:** Faça upload de múltiplos arquivos, incluindo `XML` (NF-e), `PDF` (com OCR integrado para documentos digitalizados), `CSV`, `SPED`, `DOCX`, `XLSX`, e mais.
- **Processamento em Background:** Os arquivos são enviados para um backend que processa os dados de forma assíncrona, permitindo que o usuário acompanhe o progresso em tempo real via WebSockets sem travar a interface.
- **Extração Automática de `.zip`:** Arquivos compactados são descompactados e processados individualmente no servidor.

#### 2. **Dashboard de Análise em Camadas**
- **Análise Executiva:** Logo após o processamento, um dashboard interativo apresenta um resumo com métricas chave, risco tributário, composição de impostos e insights acionáveis gerados pela IA.
- **Simulador Tributário Inteligente:** Projete cenários para os regimes `Lucro Presumido`, `Lucro Real` e `Simples Nacional`. O sistema realiza os cálculos e utiliza a IA para gerar a análise textual e as recomendações.
- **Análise Comparativa e Textual Completa (Sob Demanda):** Compare conjuntos de arquivos ou solicite um relatório textual profundo para investigações detalhadas.

#### 3. **Chat Interativo com RAG (Retrieval-Augmented Generation)**
- **Consultoria Contextual:** Converse com a IA, que responde com base no conteúdo completo dos documentos previamente processados e indexados em uma base de dados vetorial (Weaviate).
- **Anexo de Arquivos:** Anexe novos arquivos diretamente na conversa para obter respostas imediatas sobre eles.

#### 4. **Exportação Avançada de Dados**
- **Relatórios Gerenciais:** Exporte a visualização do dashboard e a conversa com a IA para os formatos `PDF`, `DOCX` e `HTML`.
- **Automação Contábil:** Gere sugestões de lançamentos contábeis e exporte-os em formato `CSV` para integração com sistemas ERP.

---

## 🏗️ Arquitetura e Pilha Tecnológica

Nexus QuantumI2A2 utiliza uma arquitetura moderna com um **Frontend (SPA)** e um **Backend-for-Frontend (BFF)**, garantindo segurança, escalabilidade e processamento eficiente.

### Frontend
- **Framework**: React 18 com TypeScript.
- **Arquitetura "No-Build"**: O projeto é executado diretamente no navegador sem um processo de build (Webpack, Vite). As dependências são gerenciadas via `importmap` no `index.html`.
- **Estilização**: Tailwind CSS (via CDN) com temas customizáveis (Dark/Light).
- **Componentes de UI & Gráficos**: Tremor React para dashboards e gráficos interativos.
- **Comunicação em Tempo Real**: WebSockets para receber atualizações de status do processamento de arquivos do backend.

### Backend (BFF)
- **Plataforma**: Node.js com Express.
- **Processamento Assíncrono**: Um sistema de jobs com `multer` para upload, `uuid` para IDs de job e um `eventBus` para orquestrar um pipeline de tarefas.
- **Gerenciamento de Estado**: **Redis** é utilizado para armazenar o estado e o progresso dos jobs de processamento.
- **Inteligência Artificial**:
  - A **API Google Gemini** (modelo `gemini-1.5-flash`) é consumida de forma segura no backend.
  - **Funções de Ferramenta (Tools)** são usadas para permitir que a IA execute tarefas específicas, como validação de CNPJ e simulações tributárias.
- **Banco de Dados Vetorial (RAG)**: **Weaviate** é usado para indexar o conteúdo dos documentos, permitindo buscas semânticas para o chat contextual.
- **Segurança**: A chave da API Gemini é gerenciada de forma segura no backend via variáveis de ambiente (`.env`), eliminando a exposição no lado do cliente.

### Pipeline de Processamento de Dados
O backend orquestra um pipeline de agentes (definido em `pipeline.yaml`) para cada job:
1.  **Extração:** Lê e extrai texto de diversos formatos de arquivo.
2.  **Validação:** Identifica e valida dados como CNPJs.
3.  **Auditoria e Classificação:** Agentes simulados que analisam e categorizam as informações.
4.  **Análise (IA):** O agente de inteligência usa a API Gemini para gerar o resumo executivo.
5.  **Indexação:** O conteúdo é vetorizado e armazenado no Weaviate para o sistema RAG.

---

## 🧩 Capacidades Avançadas

### Sistema de Memória Cognitiva
A aplicação utiliza `localStorage` no frontend para cache de UI e `Redis` / `Weaviate` no backend para persistência de dados e contexto.
- **Frontend:** Armazena o resumo da última sessão para restauração rápida do dashboard e cache de feedback do usuário.
- **Backend:**
  - **Redis:** Mantém o estado de jobs em andamento e finalizados.
  - **Weaviate:** Funciona como a memória de longo prazo, indexando o conteúdo dos documentos para o sistema RAG do chat.

### Agente de Auditoria Interna
Um agente de autoavaliação (`auditorAgent.ts`) é executado periodicamente para monitorar e "pontuar" a performance dos outros agentes do sistema, garantindo a saúde e a consistência da plataforma.

---

## 📂 Estrutura do Projeto

```
/
├── backend/              # Lógica do servidor (BFF)
│   ├── services/         # Módulos do backend (Redis, Weaviate, Parser, etc.)
│   ├── server.js         # Ponto de entrada do servidor Express e WebSocket
│   └── pipeline.yaml     # Definição do pipeline de processamento de jobs
├── components/           # Componentes React reutilizáveis (Frontend)
│   ├── dashboard/        # Componentes específicos do Dashboard
│   └── ...
├── services/             # Lógica de negócio do Frontend
│   ├── geminiService.ts  # Funções que interagem com os endpoints do BFF
│   └── ...
├── App.tsx               # Componente raiz da aplicação React
├── index.html            # Ponto de entrada HTML (contém o importmap)
├── DEPENDENCIES.md       # Catálogo de dependências
└── README.md             # Este arquivo
```

---

## 🌐 Endpoints da API

O backend expõe uma API RESTful para o frontend. Abaixo estão os principais endpoints:

### Health Check

*   **Endpoint:** `GET /api/health`
*   **Descrição:** Verifica a saúde do servidor e de suas dependências (Redis, Weaviate, chave da API Gemini).
*   **Retorno de Sucesso (200 OK):**
    ```json
    {
      "status": "ok",
      "timestamp": "2023-10-27T10:00:00.000Z",
      "services": {
        "redis": "ok",
        "weaviate": "ok",
        "gemini_api": "ok"
      }
    }
    ```
*   **Retorno de Falha (503 Service Unavailable):** Indica que um ou mais serviços estão indisponíveis.

### Gerenciamento de Jobs

*   **Endpoint:** `POST /api/jobs`
*   **Descrição:** Inicia um novo job de análise de arquivos. A requisição deve ser do tipo `multipart/form-data`.
*   **Validação de Schema:** O endpoint valida a quantidade de arquivos enviados:
    *   É necessário enviar no mínimo **1 arquivo**.
    *   O limite máximo é de **20 arquivos** por job.
*   **Retorno de Erro (400 Bad Request):** Se a validação falhar, retorna uma mensagem clara. Ex: `{"message": "É necessário enviar pelo menos 1 arquivo."}`.

---

## 🛠️ Instalação e Execução Local

### Pré-requisitos
1.  **Node.js**: Versão 18 ou superior.
2.  **Docker e Docker Compose**: Para executar os serviços de infraestrutura (Redis e Weaviate).
3.  **Chave da API Google Gemini**: Obtenha uma chave de API válida no Google AI Studio.

### 1. Usando o Script de Inicialização (Recomendado)

O projeto inclui um script para automatizar todo o processo de inicialização.

a. **Torne o script executável (apenas na primeira vez):**
    ```bash
    chmod +x start-dev.sh
    ```

b. **Execute o script:**
    ```bash
    ./start-dev.sh
    ```

O script irá:
1.  Instalar as dependências do backend.
2.  Iniciar os serviços do Docker (Redis e Weaviate).
3.  Iniciar o servidor do backend.
4.  Iniciar o servidor do frontend.
5.  Acesse a aplicação em `http://localhost:8000`.

### 2. Execução Manual (Passo a Passo)

a. **Configure as variáveis de ambiente:**
   - Crie um arquivo `.env` na pasta `backend`.
   - Adicione sua chave da API Gemini ao arquivo:
     ```env
     # backend/.env
     GEMINI_API_KEY="SUA_CHAVE_API_AQUI"
     ```

b. **Siga os passos de inicialização** do backend e frontend conforme descrito na seção "Instalação e Execução Local" do `README.md` anterior.

---

## 🤝 Como Contribuir

Contribuições são bem-vindas! Siga os passos abaixo:

1.  **Faça um Fork** do repositório.
2.  **Crie uma nova branch** para sua feature ou correção (`git checkout -b feature/minha-feature`).
3.  **Implemente suas alterações**, seguindo os padrões de código existentes.
4.  **Faça o commit** das suas alterações com uma mensagem clara (`git commit -m 'feat: Adiciona nova funcionalidade'`).
5.  **Faça o push** para a sua branch (`git push origin feature/minha-feature`).
6.  **Abra um Pull Request** detalhando as mudanças realizadas.

---

## 📄 Licença

Este projeto está licenciado sob a Licença MIT.
