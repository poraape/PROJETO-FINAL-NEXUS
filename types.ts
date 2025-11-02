// Fix: Defining all the necessary types for the application.
export enum ProcessingStepStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface PipelineStep {
  name: string;
  status: ProcessingStepStatus;
}

export interface KeyMetrics {
  numeroDeDocumentosValidos: number;
  valorTotalDasNfes: number;
  valorTotalDosProdutos: number;
  indiceDeConformidadeICMS: string;
  nivelDeRiscoTributario: 'Baixo' | 'Médio' | 'Alto';
  estimativaDeNVA: number;
  valorTotalDeICMS: number;
  valorTotalDePIS: number;
  valorTotalDeCOFINS: number;
  valorTotalDeISS: number;
}

export interface ActionableInsight {
  text: string;
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
  actionableInsights: ActionableInsight[];
  csvInsights?: CsvInsight[];
}

export interface GeneratedReport {
  executiveSummary: ExecutiveSummary;
  fullTextAnalysis: string;
}

export enum TaxRegime {
  LUCRO_PRESUMIDO = 'Lucro Presumido',
  LUCRO_REAL = 'Lucro Real',
  SIMPLES_NACIONAL = 'Simples Nacional',
}

export interface SimulationParams {
  valorBase: number;
  regimeTributario: TaxRegime;
  uf: string;
  cnae: string;
  tipoOperacao: string;
}

export interface TaxScenario {
  nome: string;
  parametros: {
    regime: string;
    uf: string;
  };
  cargaTributariaTotal: number;
  aliquotaEfetiva: string;
  impostos: {
    IRPJ?: number;
    CSLL?: number;
    PIS?: number;
    COFINS?: number;
    ICMS?: number;
    ISS?: number;
    'CPP (INSS)'?: number;
    IPI?: number;
  };
  recomendacoes: string[];
}

export interface SimulationResult {
  resumoExecutivo: string;
  recomendacaoPrincipal: string;
  cenarios: TaxScenario[];
}

export interface ChatMessage {
    sender: 'user' | 'ai';
    content: string;
    chartData?: any;
    isTyping?: boolean;
}

export interface KeyComparison {
  metricName: string;
  valueFileA: string;
  valueFileB: string;
  variance: string;
  comment: string;
}

export interface Pattern {
  description: string;
  foundIn: string[];
}

export interface Anomaly {
  fileName: string;
  description: string;
  severity: 'Baixa' | 'Média' | 'Alta';
}

export interface ComparativeAnalysisReport {
  executiveSummary: string;
  keyComparisons: KeyComparison[];
  identifiedPatterns: Pattern[];
  anomaliesAndDiscrepancies: Anomaly[];
}

export type Theme = 'light' | 'dark';

export type ErrorSeverity = 'info' | 'warning' | 'critical';

export interface LogError {
  timestamp: string;
  source: string;
  message: string;
  severity: ErrorSeverity;
  details?: any;
}
