// types.ts

export type Theme = 'dark' | 'light';

export enum ProcessingStepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
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
  simulationResult?: SimulationResult;
  validations?: any[];
  auditFindings?: AuditFindings;
  fiscalChecks?: FiscalChecks;
  classifications?: ClassificationResultPayload;
  langChainAudit?: string;
  langChainAuditFindings?: string;
  langChainClassification?: string;
}

export interface AuditValidationDetail {
  cnpj: string | null;
  status: 'active' | 'inactive' | 'error';
  message?: string | null;
  descricaoSituacao?: string | null;
  razaoSocial?: string | null;
  regimeSimples?: string | null;
}

export interface AuditSummary {
  documentsProcessed: number;
  totalEstimatedValue: number;
  totalFindings: number;
  totalMissingFields: number;
  highValueDocuments: number;
  documentsWithUnvalidatedCnpj: number;
  riskScore: number;
  riskLevel: 'Baixo' | 'Médio' | 'Alto';
}

export interface AuditDocumentFinding {
  fileName: string;
  detectedCnpjs: string[];
  missingFields: string[];
  hasIcms: boolean;
  hasIpi: boolean;
  hasPis: boolean;
  hasCofins: boolean;
  estimatedTotal: number | null;
  findings: string[];
  topMonetaryValues: number[];
}

export interface AuditFindings {
  summary: AuditSummary;
  validations: {
    total: number;
    active: number;
    inactive: number;
    errors: number;
    details: AuditValidationDetail[];
  };
  documents: AuditDocumentFinding[];
  alerts: string[];
  recommendations: string[];
}
export interface FiscalCheckDocument {
  fileName: string;
  cfops: string[];
  csts: string[];
  ncms: string[];
  icmsBase: number | null;
  icmsRate: number | null;
  icmsReported: number | null;
  icmsExpected: number | null;
  icmsDifference: number | null;
  icmsConsistent: boolean | null;
  observations: string[];
  invalidCfops?: string[];
  invalidCsts?: string[];
}

export interface FiscalCheckSummary {
  totalDocuments: number;
  missingCfop: number;
  missingCst: number;
  invalidCfop: number;
  invalidCst: number;
  icmsConsistent: number;
  icmsInconsistent: number;
  flaggedDocuments: number;
}

export interface FiscalChecks {
  summary: FiscalCheckSummary;
  documents: FiscalCheckDocument[];
}

export type FiscalRiskLevel = 'Baixo' | 'Médio' | 'Alto';

export interface DocumentClassification {
  fileName: string;
  tipoOperacao: TipoOperacao;
  setor: Setor;
  riskLevel: FiscalRiskLevel;
  riskScore: number;
  riskDrivers: string[];
  issues: string[];
  cfops: string[];
  ncms: string[];
  findings: string[];
  missingFields: string[];
  estimatedTotal: number | null;
}

export interface ClassificationSummary {
  totalDocuments: number;
  porTipoOperacao: Record<TipoOperacao, number>;
  porSetor: Record<Setor, number>;
  porRisco: Record<FiscalRiskLevel, number>;
  documentsWithPendingIssues: number;
  recommendations: string[];
}

export interface ClassificationResultPayload {
  summary: ClassificationSummary;
  documents: DocumentClassification[];
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

export interface ReconciliationInvoice {
    chave?: string;
    numero?: string;
    valor: number;
    emitente?: string;
    destino?: string;
}

export interface ReconciliationTransaction {
    date: string;
    description: string;
    amount: number;
}

export interface ReconciliationSummary {
    totalInvoices: number;
    totalTransactions: number;
    reconciled: number;
    pendingInvoices: number;
    pendingTransactions: number;
}

export interface ReconciliationMatch {
    invoice: ReconciliationInvoice;
    transaction: ReconciliationTransaction;
}

export interface ReconciliationResult {
    summary: ReconciliationSummary;
    matches: ReconciliationMatch[];
    pendingInvoices: ReconciliationInvoice[];
    pendingTransactions: ReconciliationTransaction[];
}
