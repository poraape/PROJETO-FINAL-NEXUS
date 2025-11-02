# Nexus QuantumI2A2 - Interactive Insight & Intelligence from Fiscal Analysis

![Logo](https://raw.githubusercontent.com/user/repo/main/docs/logo.png) <!-- Placeholder para logo -->

**Nexus QuantumI2A2** é uma plataforma de análise fiscal avançada que utiliza um sistema multi-agente de IA para automatizar o processamento, validação e extração de insights de documentos fiscais brasileiros. A interface web interativa permite que os usuários submetam arquivos complexos e recebam relatórios detalhados, simulações tributárias e análises comparativas em tempo real.

---

## Principais Funcionalidades

- **Análise Multimodal e Especializada de Arquivos**: Faça o upload de múltiplos arquivos em diversos formatos. O sistema utiliza bibliotecas especializadas para um pré-processamento inteligente:
  - **NF-e (XML)**: Validação e conversão automática para JSON para análise estruturada.
  - **PDF com OCR**: Extração de texto de PDFs nativos e digitalizados (imagens) com alta precisão.
  - **CSV**: Parsing eficiente de grandes volumes de dados, com amostragem automática para otimização de tokens.
  - **SPED**: Leitura e extração de resumos estruturados dos principais blocos de arquivos fiscais.
  - **Outros Formatos**: Suporte para `.ZIP` (com extração automática), `.JSON`, `.DOCX`, `.XLSX`, `.TXT` e imagens.
- **Dashboard Interativo e Completo**: Após a análise, um dashboard dinâmico apresenta:
  - **Resumo Executivo**: Métricas chave consolidadas (Valor Total de NF-e, Risco Tributário, etc.).
  - **Gráficos Visuais**: Composição de impostos e tendências de faturamento.
  - **Insights Acionáveis**: Recomendações práticas geradas pela IA.
  - **Análise Textual Completa**: O relatório detalhado da IA sobre cada arquivo.
- **Simulador Tributário Inteligente**: Projete e compare cenários fiscais (`Lucro Presumido`, `Lucro Real`, `Simples Nacional`) para otimizar a carga tributária com base nos dados analisados.
- **Análise Comparativa**: Compare dois ou mais relatórios para identificar automaticamente padrões, anomalias e discrepâncias entre eles.
- **Chat com IA Contextual e Análise de Arquivos**: Converse com a IA para aprofundar a análise do relatório, fazer perguntas específicas e **anexar novos arquivos diretamente no chat** para obter respostas contextuais e enriquecidas com gráficos.

## Arquitetura e Tecnologias

O Nexus QuantumI2A2 é um Single Page Application (SPA) moderno, construído com foco em performance e uma experiência de usuário fluida.

- **Frontend**:
  - **Framework**: React 18 com TypeScript.
  - **Estilização**: Tailwind CSS com um sistema de temas (Dark/Light).
  - **Componentes e Visualização**: [Tremor React](https://www.tremor.so/) para gráficos e componentes de UI.
  - **Módulos**: ES Modules nativos, gerenciados via `importmap` no `index.html` (sem `npm` ou bundler).
- **Inteligência Artificial**:
  - **API**: Google Gemini API (`gemini-2.5-flash`).
- **Bibliotecas de Parsing Especializado**:
  - **`papaparse`**: Para parsing de arquivos CSV.
  - **`pdfjs-dist`**: Para renderização e leitura de arquivos PDF.
  - **`tesseract.js`**: Para reconhecimento óptico de caracteres (OCR) em PDFs baseados em imagem.
  - **`xml-js`**: Para a conversão de XML para JSON.
  - **`jszip`**: Para descompactação de arquivos `.zip` no cliente.

## Estrutura do Projeto

```
/
├── components/         # Componentes React reutilizáveis
│   ├── dashboard/      # Componentes específicos do Dashboard
│   └── icons/          # Ícones SVG
├── contexts/           # React Context Providers (ErrorLogContext)
├── hooks/              # Hooks customizados (useErrorLog)
├── services/           # Lógica de negócio e comunicação com APIs
│   ├── geminiService.ts # Orquestrador de chamadas para a API Gemini
│   └── fileParsers.ts   # Módulo com parsers especializados por tipo de arquivo
├── App.tsx             # Componente principal da aplicação
├── index.html          # Ponto de entrada HTML (contém o importmap)
├── index.tsx           # Ponto de entrada do React
├── types.ts            # Definições de tipos TypeScript globais
└── README.md           # Este arquivo
```

## Instalação e Execução

Este projeto foi desenhado para ser executado diretamente no navegador sem a necessidade de um processo de build (como Webpack ou Vite).

### Pré-requisitos

1.  **Chave da API Google Gemini**: Você precisa de uma chave de API válida para o Gemini.
2.  **Servidor Web Local**: Um servidor simples para servir arquivos estáticos. Python já inclui um.

### Configuração

O aplicativo requer que a chave da API Gemini esteja disponível como uma variável de ambiente no ambiente de execução.

- **Variável de Ambiente**: `API_KEY`
  - A plataforma onde este aplicativo é executado deve injetar `process.env.API_KEY` com sua chave válida.

### Executando Localmente

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/seu-usuario/nexus-quantumi2a2.git
    cd nexus-quantumi2a2
    ```

2.  **Inicie um servidor web local:**
    Se você tem Python 3 instalado, o método mais fácil é:
    ```bash
    python -m http.server 8000
    ```
    Ou use qualquer outro servidor de sua preferência.

3.  **Acesse a aplicação:**
    Abra seu navegador e acesse `http://localhost:8000`.

**Nota**: Para que a chamada à API funcione localmente, você precisará de um mecanismo para injetar a variável de ambiente `API_KEY` no seu ambiente de desenvolvimento.

## Como Contribuir

Contribuições são bem-vindas! Siga os seguintes passos:

1.  **Fork o repositório**.
2.  **Crie uma nova branch** para sua feature ou correção (`git checkout -b feature/minha-feature`).
3.  **Implemente suas alterações**. Siga os padrões de código existentes (componentes funcionais, hooks, TypeScript).
4.  **Faça o commit** das suas alterações (`git commit -m 'feat: Adiciona nova funcionalidade'`).
5.  **Envie para a sua branch** (`git push origin feature/minha-feature`).
6.  **Abra um Pull Request** detalhando suas mudanças.

## Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

---
**Versão**: 2.0.0