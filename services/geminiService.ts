// Fix: Implementing the geminiService with mock data and Gemini API structure.
// Fix: Import GenerateContentResponse to correctly type API responses.
import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { GeneratedReport, SimulationParams, SimulationResult, ComparativeAnalysisReport } from '../types.ts';

// Per guidelines, initialize with API key from environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

// --- Retry with Exponential Backoff Logic ---
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff<T>(apiCall: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error as Error;
      const isRateLimitError = error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED'));
      
      if (isRateLimitError) {
        if (attempt < MAX_RETRIES - 1) {
          const delayTime = INITIAL_DELAY_MS * Math.pow(2, attempt);
          console.log(`Rate limit exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
          await delay(delayTime);
        } else {
           console.error(`API call failed after ${MAX_RETRIES} attempts due to rate limiting.`);
           throw lastError; 
        }
      } else {
        // Not a rate limit error, throw immediately
        throw lastError;
      }
    }
  }
  throw lastError || new Error("An unknown error occurred during API call.");
}
// --- End of Retry Logic ---


// Helper function to determine MIME type from filename if not available
const getMimeTypeFromFileName = (fileName: string): string => {
    const lowercased = fileName.toLowerCase();
    if (lowercased.endsWith('.xml')) return 'text/xml';
    if (lowercased.endsWith('.pdf')) return 'application/pdf';
    if (lowercased.endsWith('.csv')) return 'text/csv';
    if (lowercased.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lowercased.endsWith('.png')) return 'image/png';
    if (lowercased.endsWith('.jpg') || lowercased.endsWith('.jpeg')) return 'image/jpeg';
    // A generic fallback for unknown file types.
    return 'application/octet-stream';
};

// Helper function to convert a File object to a GoogleGenAI.Part object.
const fileToGenerativePart = async (file: File) => {
  const base64EncodedData = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  
  // Fix: Infer MIME type from filename if it's missing, which can happen with files from ZIPs.
  const mimeType = file.type || getMimeTypeFromFileName(file.name);

  return {
    inlineData: {
      mimeType,
      data: base64EncodedData,
    },
  };
};

const generatedReportSchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título do relatório, ex: "Análise Fiscal - Período de Apuração: Out/2023"' },
        description: { type: Type.STRING, description: 'Breve descrição do relatório.' },
        keyMetrics: {
          type: Type.OBJECT,
          properties: {
            numeroDeDocumentosValidos: { type: Type.INTEGER, description: 'Número total de documentos fiscais válidos processados.' },
            valorTotalDasNfes: { type: Type.NUMBER, description: 'Soma total dos valores de todas as NF-e e NFC-e.' },
            valorTotalDosProdutos: { type: Type.NUMBER, description: 'Soma total dos valores de todos os produtos/serviços.' },
            indiceDeConformidadeICMS: { type: Type.STRING, description: 'Percentual de conformidade de ICMS, ex: "99.2%".' },
            nivelDeRiscoTributario: { type: Type.STRING, description: 'Nível de risco classificado como "Baixo", "Médio" ou "Alto".' },
            estimativaDeNVA: { type: Type.NUMBER, description: 'Estimativa de Necessidade de Verba Adicional (NVA).' },
            valorTotalDeICMS: { type: Type.NUMBER, description: 'Valor total de ICMS apurado.' },
            valorTotalDePIS: { type: Type.NUMBER, description: 'Valor total de PIS apurado.' },
            valorTotalDeCOFINS: { type: Type.NUMBER, description: 'Valor total de COFINS apurado.' },
            valorTotalDeISS: { type: Type.NUMBER, description: 'Valor total de ISS apurado.' },
          },
          required: ['numeroDeDocumentosValidos', 'valorTotalDasNfes', 'valorTotalDosProdutos', 'indiceDeConformidadeICMS', 'nivelDeRiscoTributario', 'estimativaDeNVA', 'valorTotalDeICMS', 'valorTotalDePIS', 'valorTotalDeCOFINS', 'valorTotalDeISS'],
        },
        actionableInsights: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: 'Um insight acionável identificado na análise.' },
            },
            required: ['text'],
          },
        },
        csvInsights: {
          type: Type.ARRAY,
          description: 'Insights específicos derivados da análise de arquivos CSV. Popule este campo apenas se arquivos CSV forem fornecidos.',
          items: {
            type: Type.OBJECT,
            properties: {
              fileName: { type: Type.STRING, description: 'O nome do arquivo .csv de origem do insight.' },
              insight: { type: Type.STRING, description: 'Um resumo ou insight chave extraído dos dados tabulares do arquivo.' },
              rowCount: { type: Type.INTEGER, description: 'O número de linhas de dados (excluindo o cabeçalho) analisadas no arquivo.' }
            },
            required: ['fileName', 'insight', 'rowCount']
          }
        },
      },
      required: ['title', 'description', 'keyMetrics', 'actionableInsights'],
    },
    fullTextAnalysis: { type: Type.STRING, description: 'Uma análise textual mais detalhada e completa dos documentos.' },
  },
  required: ['executiveSummary', 'fullTextAnalysis'],
};

export const generateReportFromFiles = async (
  files: File[],
  onProgress: (stepIndex: number) => void
): Promise<GeneratedReport> => {
  console.log('Starting report generation for files:', files.map(f => f.name));
  
  if (files.length === 0) {
    throw new Error('Nenhum arquivo suportado foi fornecido para análise.');
  }

  onProgress(0); // Extraction / Reading
  const fileParts = await Promise.all(files.map(fileToGenerativePart));
  
  const systemInstruction = `Você é um sistema multi-agente especialista em análise fiscal e contábil brasileira, chamado Nexus QuantumI2A2. Sua função é processar um lote de documentos fiscais de múltiplos formatos, extrair dados com alta precisão, auditar informações, classificar operações e gerar um relatório de inteligência fiscal.
  
O processo é orquestrado por 5 agentes especializados:

1.  **Agente de Extração e Leitura (Otimizado)**: Sua primeira e mais crítica tarefa. Você deve processar todos os arquivos fornecidos com a máxima eficiência e inteligência.
    *   **Geral**: Processe arquivos em paralelo sempre que possível. Seja resiliente a erros de formatação.
    *   **XML**: Realize um parsing hierárquico profundo. Valide a estrutura contra schemas fiscais conhecidos (NF-e, CT-e) e trate namespaces (como <nfeProc>) para extrair dados corretamente.
    *   **XLSX**: Inspecione TODAS as planilhas (sheets) dentro de um arquivo. Detecte automaticamente as linhas de cabeçalho e normalize os tipos de dados das colunas (ex: converta '01/10/2023' para data, 'R$ 1.234,56' para número).
    *   **PDF**: Priorize a extração de texto estruturado e tabelas, preservando a formatação. Se o PDF contiver imagens (documento escaneado), aplique automaticamente a capacidade de OCR.
    *   **Imagens (OCR)**: Antes do OCR, aplique técnicas de pré-processamento como redução de ruído e correção de alinhamento (deskew). Detecte o idioma (Português-BR) e estruture o texto extraído em vez de apenas retorná-lo como um bloco único.
    *   **CSV**: Sua análise deve ser adaptativa. Detecte automaticamente o delimitador (vírgula, ponto e vírgula, tab), a codificação de caracteres (UTF-8, ISO-8859-1) e trate inconsistências como linhas com número de colunas diferente do cabeçalho. Para cada CSV, gere um resumo conciso e adicione-o ao campo 'csvInsights'.

2.  **Agente Auditor**: Valida a estrutura, assinaturas digitais, e consistência dos dados extraídos (ex: soma dos itens vs. valor total da nota).
3.  **Agente Classificador**: Classifica cada documento por tipo (NF-e, NFS-e), operação (entrada/saída), CFOP, e regime tributário.
4.  **Agente de Inteligência**: Analisa os dados classificados para identificar padrões, riscos fiscais, oportunidades de crédito e calcula todas as métricas chave solicitadas.
5.  **Agente Contador**: Consolida todas as descobertas em um relatório final estruturado.

Sua tarefa é executar todas essas etapas e retornar **estritamente** um objeto JSON que corresponda ao schema fornecido. Não inclua markdown ('''json''') ou qualquer outro texto fora do objeto JSON. A precisão na extração da etapa 1 é fundamental para o sucesso de todas as etapas subsequentes.`;


  onProgress(1); // Auditor
  const containsCsv = files.some(f => f.name.toLowerCase().endsWith('.csv'));
  const userPromptText = `Analise os documentos fornecidos e gere o relatório fiscal no formato JSON solicitado.${containsCsv ? ' Dê atenção especial aos arquivos .csv, aplicando a capacidade de análise aprimorada para extrair insights tabulares.' : ''}`;

  try {
    onProgress(2); // Classificador
    onProgress(3); // Inteligência
    
    const apiCall = () => ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: {
        parts: [
          ...fileParts,
          { text: userPromptText }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: generatedReportSchema,
        temperature: 0.2,
      },
    });

    // Fix: Explicitly type the response to avoid 'unknown' type error.
    const response: GenerateContentResponse = await retryWithBackoff(apiCall);

    onProgress(4); // Contador
    
    const reportJson = response.text.trim();
    const reportData = JSON.parse(reportJson);

    return reportData;

  } catch (error) {
    console.error("Gemini API error in generateReportFromFiles:", error);
    if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            throw new Error('Limite de requisições excedido. Por favor, aguarde um momento e tente novamente.');
        }
        if (error.message.includes('SAFETY')) {
            throw new Error('A análise foi bloqueada por políticas de segurança. Tente com arquivos diferentes.');
        }
        if (error.message.includes('Unsupported MIME type')) {
            throw new Error('Um ou mais tipos de arquivo não são suportados para análise. Por favor, verifique os arquivos enviados.');
        }
    }
    throw new Error('Falha ao gerar o relatório com a IA. Verifique o console para mais detalhes.');
  }
};

const simulationResultSchema = {
    type: Type.OBJECT,
    properties: {
        resumoExecutivo: { type: Type.STRING, description: 'Um parágrafo resumindo a simulação e a principal recomendação.'},
        recomendacaoPrincipal: { type: Type.STRING, description: 'O nome do regime tributário recomendado (ex: "Simples Nacional").' },
        cenarios: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    nome: { type: Type.STRING, description: 'Nome do cenário (ex: "Lucro Presumido").' },
                    parametros: {
                        type: Type.OBJECT,
                        properties: {
                            regime: { type: Type.STRING },
                            uf: { type: Type.STRING }
                        },
                        required: ['regime', 'uf']
                    },
                    cargaTributariaTotal: { type: Type.NUMBER, description: 'O valor total de impostos para este cenário.' },
                    aliquotaEfetiva: { type: Type.STRING, description: 'A alíquota efetiva em porcentagem (ex: "15.50%").' },
                    impostos: {
                        type: Type.OBJECT,
                        properties: {
                            IRPJ: { type: Type.NUMBER, description: 'Valor do IRPJ.' },
                            CSLL: { type: Type.NUMBER, description: 'Valor do CSLL.' },
                            PIS: { type: Type.NUMBER, description: 'Valor do PIS.' },
                            COFINS: { type: Type.NUMBER, description: 'Valor do COFINS.' },
                            ICMS: { type: Type.NUMBER, description: 'Valor do ICMS.' },
                            ISS: { type: Type.NUMBER, description: 'Valor do ISS.' },
                            'CPP (INSS)': { type: Type.NUMBER, description: 'Valor da Contribuição Previdenciária Patronal.' },
                            IPI: { type: Type.NUMBER, description: 'Valor do IPI.' },
                        },
                        // Impostos são opcionais dependendo do regime
                    },
                    recomendacoes: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Uma lista de recomendações ou pontos de atenção para este cenário.'
                    }
                },
                required: ['nome', 'parametros', 'cargaTributariaTotal', 'aliquotaEfetiva', 'impostos', 'recomendacoes']
            }
        }
    },
    required: ['resumoExecutivo', 'recomendacaoPrincipal', 'cenarios']
};

export const simulateTaxScenario = async (
  params: SimulationParams,
  reportContext: GeneratedReport
): Promise<SimulationResult> => {
  console.log('Simulating tax scenario with params:', params);
  
  const systemInstruction = `Você é um especialista em planejamento tributário no Brasil. Sua tarefa é simular e comparar cenários tributários com base nos dados fornecidos.
  
  Você receberá:
  1.  **Contexto do Relatório**: Um objeto JSON com os resultados de uma análise fiscal prévia.
  2.  **Parâmetros da Simulação**: Um objeto JSON com os parâmetros para a nova simulação (valor base, regime, UF, CNAE, etc.).

  Seu objetivo é calcular a carga tributária para diferentes regimes (Lucro Presumido, Lucro Real, Simples Nacional) com base nos parâmetros. Compare os resultados e forneça uma recomendação clara.

  Retorne **estritamente** um objeto JSON que corresponda ao schema fornecido. Não inclua markdown ('''json''') ou qualquer outro texto fora do objeto JSON.`;

  const userPrompt = `Com base no contexto fiscal da empresa e nos parâmetros de simulação fornecidos, execute a análise comparativa de regimes tributários.

**Contexto do Relatório (JSON):**
\`\`\`json
${JSON.stringify(reportContext.executiveSummary.keyMetrics, null, 2)}
\`\`\`

**Parâmetros da Simulação (JSON):**
\`\`\`json
${JSON.stringify(params, null, 2)}
\`\`\`

Calcule os impostos para pelo menos dois cenários relevantes (ex: Lucro Presumido e Simples Nacional) e gere o objeto JSON de resultado conforme o schema. Forneça sempre pelo menos duas recomendações para cada cenário.`;

  try {
    const apiCall = () => ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: simulationResultSchema,
        temperature: 0.3,
      },
    });

    // Fix: Explicitly type the response to avoid 'unknown' type error.
    const response: GenerateContentResponse = await retryWithBackoff(apiCall);

    const resultJson = response.text.trim();
    const resultData = JSON.parse(resultJson);

    return resultData;
  } catch (error) {
    console.error("Gemini API error in simulateTaxScenario:", error);
    if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            throw new Error('Limite de requisições excedido. Por favor, aguarde um momento e tente novamente.');
        }
        if (error.message.includes('SAFETY')) {
            throw new Error('A simulação foi bloqueada por políticas de segurança.');
        }
    }
    throw new Error('Falha ao simular o cenário com a IA. Verifique o console para mais detalhes.');
  }
};

const comparativeAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: { type: Type.STRING, description: 'Um resumo executivo da análise comparativa, destacando os principais achados.' },
    keyComparisons: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          metricName: { type: Type.STRING, description: 'Nome da métrica chave comparada (ex: "Valor Total da NF-e").' },
          valueFileA: { type: Type.STRING, description: 'Valor da métrica no primeiro arquivo/grupo.' },
          valueFileB: { type: Type.STRING, description: 'Valor da métrica no segundo arquivo/grupo.' },
          variance: { type: Type.STRING, description: 'A variação percentual ou absoluta entre os valores (ex: "+15.2%").' },
          comment: { type: Type.STRING, description: 'Um breve comentário sobre a significância da variação.' },
        },
        required: ['metricName', 'valueFileA', 'valueFileB', 'variance', 'comment'],
      },
    },
    identifiedPatterns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: 'Descrição do padrão recorrente identificado.' },
          foundIn: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Lista de nomes de arquivos onde o padrão foi encontrado.' },
        },
        required: ['description', 'foundIn'],
      },
    },
    anomaliesAndDiscrepancies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          fileName: { type: Type.STRING, description: 'Nome do arquivo onde a anomalia foi detectada.' },
          description: { type: Type.STRING, description: 'Descrição da anomalia ou discrepância encontrada.' },
          severity: { type: Type.STRING, description: 'Nível de severidade: "Baixa", "Média" ou "Alta".' },
        },
        required: ['fileName', 'description', 'severity'],
      },
    },
  },
  required: ['executiveSummary', 'keyComparisons', 'identifiedPatterns', 'anomaliesAndDiscrepancies'],
};


export const generateComparativeAnalysis = async (files: File[]): Promise<ComparativeAnalysisReport> => {
  if (files.length < 2) {
    throw new Error('A análise comparativa requer pelo menos 2 arquivos.');
  }

  const fileParts = await Promise.all(files.map(fileToGenerativePart));

  const systemInstruction = `Você é um analista de dados sênior especializado em inteligência de negócios e auditoria fiscal. Sua tarefa é realizar uma análise comparativa profunda entre o conjunto de arquivos fornecidos.
  
Seu objetivo é identificar:
1.  **Discrepâncias em Métricas Chave**: Compare valores totais, contagens de itens, valores de impostos, etc., entre diferentes arquivos ou períodos.
2.  **Padrões Recorrentes**: Encontre padrões de transações, fornecedores/clientes comuns, ou estruturas de dados similares.
3.  **Anomalias e Outliers**: Detecte transações, valores ou estruturas que fogem do padrão geral.

Concentre-se em fornecer insights acionáveis e claros. Baseie-se estritamente nos dados dos arquivos.

Retorne **estritamente** um objeto JSON que corresponda ao schema fornecido. Não inclua markdown ('''json''') ou qualquer outro texto fora do objeto JSON.`;

  const userPrompt = `Com base nos ${files.length} arquivos fornecidos, realize uma análise comparativa detalhada e gere o relatório no formato JSON solicitado. Identifique as diferenças e semelhanças mais impactantes.`;

  try {
    const apiCall = () => ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: {
        parts: [
          ...fileParts,
          { text: userPrompt },
        ],
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: comparativeAnalysisSchema,
        temperature: 0.4,
      },
    });

    // Fix: Explicitly type the response to avoid 'unknown' type error.
    const response: GenerateContentResponse = await retryWithBackoff(apiCall);

    const resultJson = response.text.trim();
    const resultData = JSON.parse(resultJson);
    return resultData;
  } catch (error) {
    console.error("Gemini API error in generateComparativeAnalysis:", error);
    if (error instanceof Error) {
        if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
            throw new Error('Limite de requisições excedido. Por favor, aguarde um momento e tente novamente.');
        }
        if (error.message.includes('SAFETY')) {
            throw new Error('A análise comparativa foi bloqueada por políticas de segurança.');
        }
    }
    throw new Error('Falha ao gerar a análise comparativa com a IA.');
  }
};