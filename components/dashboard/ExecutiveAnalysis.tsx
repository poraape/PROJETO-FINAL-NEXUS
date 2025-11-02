
// Fix: Implementing the ExecutiveAnalysis component to display report data.
import React from 'react';
import { ExecutiveSummary } from '../../types';
import { MetricCard } from './MetricCard';
import { NfeTrendChart } from './NfeTrendChart';
import { TaxChart } from './TaxChart';
import { PaperIcon } from '../icons/PaperIcon';
import { CsvAnalysisInsights } from './CsvAnalysisInsights';

interface ExecutiveAnalysisProps {
  summary: ExecutiveSummary;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

export const ExecutiveAnalysis: React.FC<ExecutiveAnalysisProps> = ({ summary }) => {
  const insights = [
    ...(summary.actionableInsights || []),
    { text: "O 'Índice de Conformidade de ICMS' elevado sugere processos fiscais robustos, mas a monitoria contínua é crucial." },
    { text: "Um 'Nível de Risco Tributário' baixo é positivo, mas requer validação periódica das regras fiscais para se manter." },
  ];

  return (
    <div className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-6 h-full">
      <div className="flex items-center mb-6">
        <div className="bg-blue-500/20 p-3 rounded-xl mr-4">
            <PaperIcon className="w-6 h-6 text-blue-300" />
        </div>
        <div>
            <h2 className="text-2xl font-bold text-content-emphasis">{summary.title}</h2>
            <p className="text-content-default">{summary.description}</p>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-content-emphasis mb-4">Métricas Chave</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <MetricCard title="Documentos Válidos" value={summary.keyMetrics.numeroDeDocumentosValidos.toString()} />
        <MetricCard title="Valor Total NF-e" value={formatCurrency(summary.keyMetrics.valorTotalDasNfes)} />
        <MetricCard title="Valor Total Produtos" value={formatCurrency(summary.keyMetrics.valorTotalDosProdutos)} />
        <MetricCard title="Índice Conformidade ICMS" value={summary.keyMetrics.indiceDeConformidadeICMS} isAlert={parseFloat(summary.keyMetrics.indiceDeConformidadeICMS.replace('%', '')) < 99} />
        <MetricCard title="Nível Risco Tributário" value={summary.keyMetrics.nivelDeRiscoTributario} isAlert={summary.keyMetrics.nivelDeRiscoTributario !== 'Baixo'}/>
        <MetricCard title="Estimativa NVA" value={formatCurrency(summary.keyMetrics.estimativaDeNVA)} description="Necessidade de Verba" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <TaxChart metrics={summary.keyMetrics} />
        <NfeTrendChart value={summary.keyMetrics.valorTotalDasNfes} />
      </div>

      {summary.csvInsights && summary.csvInsights.length > 0 && (
          <CsvAnalysisInsights insights={summary.csvInsights} />
      )}

      <h3 className="text-lg font-semibold text-content-emphasis mb-4 mt-6">Insights Acionáveis</h3>
      <ul className="space-y-3">
        {insights.map((insight, index) => (
          <li key={index} className="flex items-start">
            <span className="text-accent mr-3 mt-1">◆</span>
            <p className="text-content-default">{insight.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};
