// types.ts

export type Theme = 'dark' | 'light';

export enum ProcessingStepStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface PipelineStep {
  name: string;
  status: ProcessingStepStatus;
  info?: string;
}

export interface KeyMetrics {
  numeroDeDocumentosValidos: number;
  valorTotalDasNfes: number;
  valorTotalDosProdutos: number;
  indiceDeConformidadeICMS: string;
  nivelDeRiscoTributario: 'Baixo' | 'Média' | 'Alto';
  estimativaDeNVA: number;
  valorTotalDeICMS: number;
  valorTotalDePIS: number;
  valorTotalDeCOFINS: number;
  valorTotalDeISS: number;
}

export interface CsvInsight {
  fileName: string;
  insight: string;
  rowCount: number;
}

export interface ExecutiveSummary {
  title: string;
  description: string;
  keyMetrics: KeyMetrics;
  actionableInsights: { text: string }[];
  csvInsights?: CsvInsight[];
}

export interface GeneratedReport {
  executiveSummary: ExecutiveSummary;
  fullTextAnalysis?: string;
}

export type ErrorSeverity = 'critical' | 'warning' | 'info';

export interface LogError {
  timestamp: string;
  source: string;
  message: string;
  severity: ErrorSeverity;
  details?: any;
}

export enum TaxRegime {
  SIMPLES_NACIONAL = 'Simples Nacional',
  LUCRO_PRESUMIDO = 'Lucro Presumido',
  LUCRO_REAL = 'Lucro Real',
}

export interface SimulationParams {
  valorBase: number;
  regimeTributario: TaxRegime;
  uf: string;
  cnae: string;
  tipoOperacao: string;
}

export interface TaxScenario {
  nome: TaxRegime;
  parametros: { regime: TaxRegime, uf: string };
  cargaTributariaTotal: number;
  aliquotaEfetiva: string;
  impostos: { [key: string]: number };
  recomendacoes: string[];
}

export interface SimulationResult {
  resumoExecutivo: string;
  recomendacaoPrincipal: string;
  cenarios: TaxScenario[];
}

export interface ComparativeAnalysisReport {
    executiveSummary: string;
    keyComparisons: {
        metricName: string;
        valueFileA: string;
        valueFileB: string;
        variance: string;
        comment: string;
    }[];
    identifiedPatterns: {
        description: string;
        foundIn: string[];
    }[];
    anomaliesAndDiscrepancies: {
        fileName: string;
        description: string;
        severity: 'Baixa' | 'Média' | 'Alta';
    }[];
}


export interface ChartConfig {
  type: 'bar' | 'line' | 'pie';
  title: string;
  xField: string;
  yField: string;
  data: { [key: string]: any }[];
}

export interface ChatMessage {
  sender: 'user' | 'ai';
  content: string;
  chartData?: ChartConfig | null;
}

export interface DocumentoFiscalDetalhado {
  fileName: string;
  chave: string;
  itens: {
    cfop: string;
    ncm: string;
    xProd: string;
    imposto?: any;
    [key: string]: any;
  }[];
  valorImpostos?: number;
  semaforoFiscal?: 'ok' | 'warning' | 'error';
  validationIssues?: string[];
  [key: string]: any;
}

export type TipoOperacao = 'compra' | 'venda' | 'serviço' | 'desconhecido';
export type Setor = 'agronegócio' | 'indústria' | 'varejo' | 'transporte' | 'outros';

export interface ClassificationResult {
    fileName: string;
    chave: string;
    tipo_operacao: TipoOperacao;
    setor: Setor;
}

export interface MonthlyData {
    total: number;
    impostos: number;
}

export interface ForecastResult {
    previsaoProximoMes: {
        faturamento: number;
        impostos: number;
    };
    historicoMensal: { [month: string]: MonthlyData };
}