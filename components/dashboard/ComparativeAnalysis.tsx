import React from 'react';
import { Card, Title, Text, Button, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ComparativeAnalysisReport } from '../../types.ts';
import { CompareIcon } from '../icons/CompareIcon.tsx';
import { useErrorLog } from '../../hooks/useErrorLog.ts';

interface ComparativeAnalysisProps {
  files: File[];
  onStart: () => void;
  isLoading: boolean;
  error: string | null;
  report: ComparativeAnalysisReport | null;
}

const severityColor: { [key: string]: 'rose' | 'amber' | 'gray' } = {
  'Alta': 'rose',
  'Média': 'amber',
  'Baixa': 'gray',
};

export const ComparativeAnalysis: React.FC<ComparativeAnalysisProps> = ({ files, onStart, isLoading, error, report }) => {
  const canCompare = files.length >= 2;
  const { logError } = useErrorLog(); // This is a placeholder, as the actual call is in Dashboard.tsx

  const renderInitialState = () => (
    <div className="text-center h-full flex flex-col justify-center items-center">
      <div className="bg-orange-500/20 p-4 rounded-2xl mb-4">
        <CompareIcon className="w-10 h-10 text-orange-300" />
      </div>
      <h3 className="text-xl font-bold text-content-emphasis">Análise Comparativa Inteligente</h3>
      <p className="text-content-default mt-2 max-w-md">
        Compare múltiplos arquivos para encontrar discrepâncias, padrões e anomalias automaticamente.
      </p>
      <p className="text-sm text-content-default/70 mt-4">{files.length} arquivo(s) pronto(s) para análise.</p>
      <Button 
        onClick={onStart} 
        disabled={!canCompare || isLoading}
        className="mt-6 bg-orange-500 hover:bg-orange-600 border-orange-400 text-white font-bold"
        loading={isLoading}
      >
        {canCompare ? 'Iniciar Análise Comparativa' : 'Envie pelo menos 2 arquivos'}
      </Button>
    </div>
  );

  const renderReport = () => {
    if (!report) return null;
    return (
        <div className="space-y-6">
            <Card className="bg-bg-secondary/50 border border-border-glass ring-0">
                <Title className="text-content-emphasis">Resumo Executivo da Comparação</Title>
                <Text className="text-content-default mt-2">{report.executiveSummary}</Text>
            </Card>

            <Card className="bg-bg-secondary/50 border border-border-glass ring-0">
                <Title className="text-content-emphasis">Comparação de Métricas Chave</Title>
                <Table className="mt-4">
                    <TableHead>
                        <TableRow>
                            <TableHeaderCell className="text-content-default">Métrica</TableHeaderCell>
                            <TableHeaderCell className="text-content-default">Variação</TableHeaderCell>
                            <TableHeaderCell className="text-content-default">Comentário</TableHeaderCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {report.keyComparisons.map((item) => (
                            <TableRow key={item.metricName}>
                                <TableCell className="text-content-emphasis font-semibold">{item.metricName}</TableCell>
                                <TableCell>
                                    <Badge color={item.variance.startsWith('+') ? 'emerald' : 'rose'}>{item.variance}</Badge>
                                </TableCell>
                                <TableCell className="text-content-default text-sm">{item.comment}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-bg-secondary/50 border border-border-glass ring-0">
                    <Title className="text-content-emphasis">Padrões Identificados</Title>
                     <Table className="mt-2">
                        <TableBody>
                            {report.identifiedPatterns.map((item, idx) => (
                                <TableRow key={idx}>
                                    <TableCell className="text-content-emphasis">{item.description}</TableCell>
                                    <TableCell className="text-right text-xs text-content-default">({item.foundIn.join(', ')})</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
                <Card className="bg-bg-secondary/50 border border-border-glass ring-0">
                    <Title className="text-content-emphasis">Anomalias e Discrepâncias</Title>
                     <Table className="mt-2">
                        <TableHead>
                            <TableRow>
                                <TableHeaderCell className="text-content-default">Arquivo</TableHeaderCell>
                                <TableHeaderCell className="text-content-default">Descrição</TableHeaderCell>
                                <TableHeaderCell className="text-content-default">Severidade</TableHeaderCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {report.anomaliesAndDiscrepancies.map((item, idx) => (
                                <TableRow key={idx}>
                                    <TableCell className="text-content-default text-sm">{item.fileName}</TableCell>
                                    <TableCell className="text-content-emphasis">{item.description}</TableCell>
                                    <TableCell><Badge color={severityColor[item.severity]}>{item.severity}</Badge></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            </div>
        </div>
    );
  };
  
  return (
    <div className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-6 h-full flex flex-col animate-subtle-bob">
      {error && <div className="text-center text-red-400 p-4 bg-red-500/10 rounded-lg mb-4">{error}</div>}
      <div className="flex-1 overflow-y-auto pr-2">
        {report ? renderReport() : renderInitialState()}
      </div>
    </div>
  );
};
