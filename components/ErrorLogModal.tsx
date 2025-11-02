import React, { useState } from 'react';
// Fix: Import `Title` component from `@tremor/react` to resolve 'Cannot find name' error.
import { Dialog, DialogPanel, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button, Select, SelectItem, Title } from '@tremor/react';
import { useErrorLog } from '../hooks/useErrorLog.ts';
import { LogError, ErrorSeverity } from '../types.ts';

interface ErrorLogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const severityColors: { [key in ErrorSeverity]: 'red' | 'amber' | 'sky' } = {
  critical: 'red',
  warning: 'amber',
  info: 'sky',
};

const severityLabels: { [key in ErrorSeverity]: string } = {
    critical: 'Crítico',
    warning: 'Aviso',
    info: 'Informativo'
};

export const ErrorLogModal: React.FC<ErrorLogModalProps> = ({ isOpen, onClose }) => {
  const { logs } = useErrorLog();
  const [selectedSeverity, setSelectedSeverity] = useState<ErrorSeverity | 'all'>('all');
  const [selectedLog, setSelectedLog] = useState<LogError | null>(null);

  const filteredLogs = selectedSeverity === 'all'
    ? logs
    : logs.filter(log => log.severity === selectedSeverity);
    
  const downloadJSON = () => {
    const dataStr = JSON.stringify(filteredLogs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = 'error_logs.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };
  
  const downloadCSV = () => {
    const header = ['timestamp', 'severity', 'source', 'message', 'details'];
    const rows = filteredLogs.map(log => [
      log.timestamp,
      log.severity,
      log.source,
      `"${log.message.replace(/"/g, '""')}"`,
      `"${JSON.stringify(log.details).replace(/"/g, '""')}"`
    ].join(','));
    const csvContent = [header.join(','), ...rows].join('\n');
    const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    const exportFileDefaultName = 'error_logs.csv';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  return (
    <Dialog open={isOpen} onClose={onClose} static={true}>
      <DialogPanel className="max-w-4xl bg-bg-secondary-opaque border border-border-glass rounded-2xl shadow-glass">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-content-emphasis">Log de Erros do Sistema</h3>
            <div className="flex items-center gap-4">
                 <Select value={selectedSeverity} onValueChange={(val) => setSelectedSeverity(val as ErrorSeverity | 'all')} className="w-48">
                    <SelectItem value="all">Todas Severidades</SelectItem>
                    <SelectItem value="critical">Crítico</SelectItem>
                    <SelectItem value="warning">Aviso</SelectItem>
                    <SelectItem value="info">Informativo</SelectItem>
                </Select>
                <Button onClick={downloadCSV}>Exportar CSV</Button>
                <Button onClick={downloadJSON}>Exportar JSON</Button>
                <Button variant="light" onClick={onClose}>Fechar</Button>
            </div>
        </div>
        
        <div className="h-[60vh] overflow-y-auto border border-border-glass rounded-lg">
            <Table>
                <TableHead className="sticky top-0 bg-bg-secondary-opaque/80 backdrop-blur-sm">
                    <TableRow>
                        <TableHeaderCell>Timestamp</TableHeaderCell>
                        <TableHeaderCell>Severidade</TableHeaderCell>
                        <TableHeaderCell>Origem</TableHeaderCell>
                        <TableHeaderCell>Mensagem</TableHeaderCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {filteredLogs.map((log, idx) => (
                        <TableRow key={idx} onClick={() => setSelectedLog(log)} className="cursor-pointer hover:bg-white/5">
                            <TableCell className="font-mono text-xs">{new Date(log.timestamp).toLocaleString()}</TableCell>
                            <TableCell><Badge color={severityColors[log.severity]}>{severityLabels[log.severity]}</Badge></TableCell>
                            <TableCell>{log.source}</TableCell>
                            <TableCell className="max-w-xs truncate">{log.message}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
        {selectedLog && (
            <Dialog open={!!selectedLog} onClose={() => setSelectedLog(null)}>
                <DialogPanel className="max-w-2xl bg-bg-secondary-opaque border border-border-glass rounded-2xl">
                    <Title className="text-content-emphasis">Detalhes do Log</Title>
                    <pre className="mt-4 text-xs bg-black/30 p-4 rounded-lg overflow-auto h-96 text-content-default font-mono">
                        {JSON.stringify(selectedLog, null, 2)}
                    </pre>
                    <div className="mt-4 flex justify-end">
                        <Button variant="light" onClick={() => setSelectedLog(null)}>Fechar</Button>
                    </div>
                </DialogPanel>
            </Dialog>
        )}
      </DialogPanel>
    </Dialog>
  );
};