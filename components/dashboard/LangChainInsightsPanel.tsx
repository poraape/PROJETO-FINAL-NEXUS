import React from 'react';
import type { GeneratedReport } from '../../types.ts';

const tryParseJson = (value: string | object) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const renderContent = (content: string | object | undefined) => {
  if (!content) {
    return <span className="text-content-muted text-xs">Sem dados disponíveis.</span>;
  }

  const parsed = tryParseJson(content);
  if (typeof parsed === 'object') {
    return (
      <pre className="text-[0.75rem] font-mono whitespace-pre-wrap breaking-words bg-bg-secondary/40 rounded-lg p-2">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  }

  return (
    <p className="text-sm leading-relaxed text-content-default">
      {parsed}
    </p>
  );
};

interface LangChainInsightsPanelProps {
  report: GeneratedReport;
}

const InsightsSection: React.FC<{ label: string; value?: string | object }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-[0.65rem] uppercase tracking-wider font-semibold text-accent-light">
        {label}
      </p>
      {renderContent(value)}
    </div>
  );
};

export const LangChainInsightsPanel: React.FC<LangChainInsightsPanelProps> = ({ report }) => {
  const hasAny = report.langChainAudit || report.langChainAuditFindings || report.langChainClassification;
  if (!hasAny) return null;

  return (
    <section className="bg-bg-primary/60 border border-border-glass rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-content-emphasis">Insights LangChain</p>
        <p className="text-xs text-content-muted">
          Auditoria cognitiva em tempo real baseada nos resultados do pipeline. Sem alterar o layout.
        </p>
      </div>
      <div className="space-y-3">
        <InsightsSection label="Revisão Executiva" value={report.langChainAudit} />
        <InsightsSection label="Achados de Auditoria" value={report.langChainAuditFindings} />
        <InsightsSection label="Classificação Inteligente" value={report.langChainClassification} />
      </div>
    </section>
  );
};
