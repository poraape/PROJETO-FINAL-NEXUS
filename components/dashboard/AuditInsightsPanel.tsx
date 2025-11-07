import React from 'react';
import { AuditFindings, ClassificationResultPayload, FiscalChecks } from '../../types.ts';

interface AuditInsightsPanelProps {
  audit: AuditFindings;
  classifications?: ClassificationResultPayload | null;
  fiscalChecks?: FiscalChecks | null;
}

const riskColors: Record<string, string> = {
  Baixo: 'text-emerald-300',
  Médio: 'text-amber-300',
  Alto: 'text-red-400',
};

const barColors: Record<string, string> = {
  Baixo: 'bg-emerald-400/70',
  Médio: 'bg-amber-400/70',
  Alto: 'bg-red-500/70',
};

const formatNumber = (value: number | undefined | null) => {
  if (value === undefined || value === null) return '0';
  return value.toLocaleString('pt-BR');
};

export const AuditInsightsPanel: React.FC<AuditInsightsPanelProps> = ({ audit, classifications, fiscalChecks }) => {
  const { summary, alerts = [], recommendations = [] } = audit;
  const riskLevel = summary.riskLevel || 'Baixo';
  const riskScore = Math.min(Math.max(Math.round(summary.riskScore || 0), 0), 100);
  const topAlerts = alerts.slice(0, 3);
  const topRecommendations = recommendations.slice(0, 3);

  const classificationSummary = classifications?.summary;
  const fiscalSummary = fiscalChecks?.summary;

  return (
    <div className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-content-emphasis">Painel de Risco Fiscal</h3>
          <p className="text-xs text-content-default/70">Consolida auditoria determinística, validações e classificação por documento.</p>
        </div>
        <span className={`text-sm font-semibold ${riskColors[riskLevel] || 'text-content-emphasis'}`}>Risco {riskLevel}</span>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-content-default/60">
          <span>Score de risco</span>
          <span>{riskScore}/100</span>
        </div>
        <div className="mt-1 h-2 bg-border-glass rounded-full overflow-hidden">
          <div
            className={`${barColors[riskLevel] || 'bg-accent/60'} h-full transition-all duration-500`}
            style={{ width: `${riskScore}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-white/5 rounded-2xl px-3 py-2">
          <p className="text-content-default/60">Alertas totais</p>
          <p className="text-content-emphasis text-lg font-semibold">{formatNumber(summary.totalFindings)}</p>
        </div>
        <div className="bg-white/5 rounded-2xl px-3 py-2">
          <p className="text-content-default/60">Docs alto valor</p>
          <p className="text-content-emphasis text-lg font-semibold">{formatNumber(summary.highValueDocuments)}</p>
        </div>
        <div className="bg-white/5 rounded-2xl px-3 py-2">
          <p className="text-content-default/60">Pendências na classificação</p>
          <p className="text-content-emphasis text-lg font-semibold">{formatNumber(classificationSummary?.documentsWithPendingIssues)}</p>
        </div>
        <div className="bg-white/5 rounded-2xl px-3 py-2">
          <p className="text-content-default/60">Divergências ICMS</p>
          <p className="text-content-emphasis text-lg font-semibold">{formatNumber(fiscalSummary?.icmsInconsistent)}</p>
        </div>
      </div>

      {classificationSummary && (
        <div className="text-xs space-y-1">
          <p className="uppercase tracking-wide text-content-default/50">Distribuição de risco</p>
          <div className="flex flex-wrap gap-2">
            {(['Baixo', 'Médio', 'Alto'] as const).map(level => (
              <span key={level} className="bg-white/5 rounded-full px-3 py-1 text-content-default/80">
                {level}: {formatNumber(classificationSummary.porRisco[level])}
              </span>
            ))}
          </div>
        </div>
      )}

      {fiscalSummary && (
        <div className="text-xs space-y-1">
          <p className="uppercase tracking-wide text-content-default/50">Cobertura fiscal</p>
          <p className="text-content-default/70">
            CFOP ausentes: {formatNumber(fiscalSummary.missingCfop)} · CST ausentes: {formatNumber(fiscalSummary.missingCst)} · Registros analisados: {formatNumber(fiscalSummary.totalDocuments)}
          </p>
        </div>
      )}

      {topAlerts.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-content-default/50 mb-1">Principais alertas</p>
          <ul className="space-y-1 text-xs text-content-default/80">
            {topAlerts.map((alert, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-accent">{idx + 1}.</span>
                <span className="flex-1">{alert}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topRecommendations.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-content-default/50 mb-1">Ações recomendadas</p>
          <ul className="space-y-1 text-xs text-content-default/80">
            {topRecommendations.map((rec, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-emerald-300">{idx + 1}.</span>
                <span className="flex-1">{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
