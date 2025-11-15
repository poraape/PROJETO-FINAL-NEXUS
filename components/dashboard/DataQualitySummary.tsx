import React from 'react';
import { Card, Text } from '@tremor/react';
import { DataQualityReport } from '../../types.ts';

interface Props {
  report?: DataQualityReport | null;
}

export const DataQualitySummary: React.FC<Props> = ({ report }) => {
  if (!report) return null;

  return (
    <Card className="bg-bg-secondary/60 border border-border-glass">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-lg font-semibold text-content-emphasis">Saúde da Ingestão</h4>
        <Text className="text-[11px] text-content-default/60">Atualizado em {new Date(report.generatedAt).toLocaleString('pt-BR')}</Text>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <Text className="text-content-default/70">Arquivos avaliados</Text>
          <p className="text-content-emphasis text-lg font-semibold">{report.totals.files}</p>
        </div>
        <div>
          <Text className="text-content-default/70">Estruturados</Text>
          <p className="text-content-emphasis text-lg font-semibold">{report.totals.structured}</p>
        </div>
        <div>
          <Text className="text-content-default/70">Alertas</Text>
          <p className="text-amber-300 text-lg font-semibold">{report.totals.warnings}</p>
        </div>
        <div>
          <Text className="text-content-default/70">Erros críticos</Text>
          <p className="text-red-400 text-lg font-semibold">{report.totals.errors}</p>
        </div>
      </div>
      <div className="mt-4 text-xs text-content-default/70">
        <p className="font-semibold mb-1">Codificações detectadas</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(report.encodingStats).map(([encoding, count]) => (
            <span key={encoding} className="px-2 py-1 rounded-full bg-white/5 border border-border-glass/60">
              {encoding.toUpperCase()}: {count}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
};
