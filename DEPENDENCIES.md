# Catálogo de Dependências - Nexus QuantumI2A2

Este documento fornece uma lista completa e organizada de todas as dependências e bibliotecas utilizadas no aplicativo, especificando suas versões, finalidades e pontos de uso. A aplicação utiliza uma arquitetura sem processo de build (`npm`, `webpack`), com as dependências gerenciadas diretamente via `importmap` no arquivo `index.html`.

---

## Core do Frontend

Bibliotecas essenciais que formam a base da aplicação web.

### 1. React
- **Versão:** `^18.2.0`
- **Módulo/Camada:** Frontend (Core UI)
- **Finalidade:** Biblioteca principal para a construção da interface de usuário (UI) de forma declarativa e baseada em componentes.
- **Pontos de Uso:** Utilizada em todos os arquivos `.tsx` para definir a estrutura, lógica e estado dos componentes visuais.
- **Motivo da Escolha:** Padrão de mercado para Single Page Applications (SPA), com um vasto ecossistema, alta performance e um modelo de componentização que promove a reutilização de código e a manutenibilidade.

### 2. React DOM
- **Versão:** `^18.2.0`
- **Módulo/Camada:** Frontend (Renderização)
- **Finalidade:** Responsável por renderizar os componentes React no DOM do navegador, servindo como a ponte entre o código da aplicação e a página web.
- **Pontos de Uso:** No arquivo `index.tsx`, para inicializar e montar o componente `App` no elemento `div#root`.
- **Motivo da Escolha:** É a biblioteca oficial e essencial para o uso de React em aplicações web.

---

## UI & Visualização

Frameworks e bibliotecas para estilização, componentes de interface e gráficos.

### 1. Tailwind CSS
- **Versão:** `3.x` (via CDN)
- **Módulo/Camada:** Frontend (Estilização)
- **Finalidade:** Framework CSS utility-first que permite a construção de interfaces customizadas de forma rápida e eficiente, sem a necessidade de escrever CSS tradicional.
- **Pontos de Uso:** Aplicado em todos os componentes `.tsx` para estilização. A configuração e o tema (cores, fontes, etc.) são definidos no `index.html`.
- **Motivo da Escolha:** Alta produtividade, consistência visual, e facilidade de manutenção. O uso via CDN se alinha perfeitamente à arquitetura sem build do projeto.

### 2. Tremor
- **Versão:** `3.17.2`
- **Módulo/Camada:** Frontend (Componentes de UI / Dashboard)
- **Finalidade:** Biblioteca de componentes React de baixo código, projetada para a criação rápida de dashboards e interfaces de análise de dados.
- **Pontos de Uso:** Amplamente utilizada nos componentes do diretório `components/dashboard/` para criar cartões de métricas (`MetricCard`), gráficos (`TaxChart`, `NfeTrendChart`), tabelas (`ComparativeAnalysis`) e outros elementos de UI.
- **Motivo da Escolha:** Simplifica drasticamente a criação de visualizações de dados complexas e esteticamente agradáveis, permitindo focar na lógica de negócio.

### 3. Recharts
- **Versão:** `2.12.7`
- **Módulo/Camada:** Frontend (Visualização / Gráficos)
- **Finalidade:** Biblioteca de gráficos para React.
- **Pontos de Uso:** É uma dependência **indireta**, utilizada internamente pelo **Tremor** para renderizar seus componentes de gráfico.
- **Motivo da Escolha:** É a biblioteca de gráficos escolhida pelo Tremor, conhecida por sua flexibilidade e composição.

### 4. Radix UI Primitives
- **Versão:** `1.0.3`
- **Módulo/Camada:** Frontend (Base de Componentes)
- **Finalidade:** Fornece um conjunto de primitivas de UI de baixo nível, acessíveis e não estilizadas.
- **Pontos de Uso:** Dependência **indireta**, utilizada pelo **Tremor** como base para a construção de seus componentes, garantindo acessibilidade e conformidade com os padrões WAI-ARIA.
- **Motivo da Escolha:** Escolha do Tremor por sua qualidade, foco em acessibilidade e flexibilidade.

---

## Processamento de Dados, Parsing & API

Bibliotecas para manipulação de dados no cliente e comunicação com serviços externos.

### 1. Google Gemini API Client (`@google/genai`)
- **Versão:** `^1.28.0`
- **Módulo/Camada:** Frontend (Serviços / IA)
- **Finalidade:** Cliente oficial para interagir com a API do Google Gemini. Facilita o envio de prompts, o gerenciamento de conversas e o processamento de respostas multimodais.
- **Pontos de Uso:** Centralizado no `services/geminiService.ts`, onde é utilizado para todas as funcionalidades de IA.
- **Motivo da Escolha:** Biblioteca oficial da Google, garantindo total compatibilidade, segurança e acesso às funcionalidades mais recentes da API Gemini.

### 2. JSZip
- **Versão:** `3.10.1`
- **Módulo/Camada:** Frontend (Processamento de Arquivos)
- **Finalidade:** Permite criar, ler e editar arquivos no formato `.zip` diretamente no navegador.
- **Pontos de Uso:** No componente `App.tsx`, para descompactar arquivos `.zip` enviados pelo usuário.
- **Motivo da Escolha:** Biblioteca robusta e eficiente para manipulação de arquivos zip em JavaScript.

### 3. xml-js
- **Versão:** `1.6.11`
- **Módulo/Camada:** Frontend (Processamento de Dados / Parsing)
- **Finalidade:** Realiza a conversão de dados entre os formatos XML e JSON.
- **Pontos de Uso:** No `services/fileParsers.ts`, para converter o conteúdo de arquivos `.xml` (como NF-e) para um formato JSON mais estruturado e otimizado para a análise pela IA.
- **Motivo da Escolha:** Biblioteca leve, sem dependências e de fácil uso.

### 4. PapaParse
- **Versão:** `5.4.1`
- **Módulo/Camada:** Frontend (Processamento de Dados / Parsing)
- **Finalidade:** Um dos parsers de CSV mais rápidos e robustos para JavaScript. Suporta arquivos grandes, streaming e detecção automática de delimitadores.
- **Pontos de Uso:** No `services/fileParsers.ts`, para processar arquivos `.csv`, extraindo um extrato de dados em formato JSON para otimizar a análise pela IA.
- **Motivo da Escolha:** Performance, confiabilidade e capacidade de lidar com arquivos grandes de forma eficiente no navegador.

### 5. PDF.js
- **Versão:** `4.3.136`
- **Módulo/Camada:** Frontend (Processamento de Arquivos / Parsing)
- **Finalidade:** Biblioteca desenvolvida pela Mozilla para renderizar e analisar arquivos PDF no navegador.
- **Pontos de Uso:** No `services/fileParsers.ts`, para ler a estrutura de arquivos PDF, extrair texto de documentos nativos e renderizar páginas como imagens para o processo de OCR.
- **Motivo da Escolha:** Padrão de mercado para manipulação de PDFs na web, com excelente compatibilidade e mantido por uma grande organização.

### 6. Tesseract.js
- **Versão:** `5.1.0`
- **Módulo/Camada:** Frontend (Processamento de Arquivos / OCR)
- **Finalidade:** Porta do popular motor de OCR Tesseract para JavaScript. Permite extrair texto de imagens diretamente no navegador.
- **Pontos de Uso:** No `services/fileParsers.ts`, em conjunto com o PDF.js, para realizar o reconhecimento óptico de caracteres em páginas de PDF que são, na verdade, imagens escaneadas.
- **Motivo da Escolha:** A solução de OCR open-source mais madura e precisa disponível para o ambiente do navegador.