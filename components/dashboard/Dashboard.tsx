import React, { useState, useCallback } from 'react';
import { GeneratedReport, SimulationResult, ComparativeAnalysisReport, LogError } from '../../types.ts';
import { ExecutiveAnalysis } from './ExecutiveAnalysis.tsx';
import { InteractiveChat } from './InteractiveChat.tsx';
import { TaxSimulator } from './TaxSimulator.tsx';
import { PaperIcon } from '../icons/PaperIcon.tsx';
import { CalculatorIcon } from '../icons/CalculatorIcon.tsx';
import { FileTextIcon } from '../icons/FileTextIcon.tsx';
import { FullTextAnalysis } from './FullTextAnalysis.tsx';
import { CompareIcon } from '../icons/CompareIcon.tsx';
import { ComparativeAnalysis } from './ComparativeAnalysis.tsx';
import { generateComparativeAnalysis, generateFullTextAnalysis } from '../../services/geminiService.ts';

interface DashboardProps {
  initialReport: GeneratedReport;
  processedFiles: File[];
  onAnalyzeOther: () => void;
  logError: (error: Omit<LogError, 'timestamp'>) => void;
}

type DashboardView = 'analysis' | 'simulator' | 'fullText' | 'comparison';

export const Dashboard: React.FC<DashboardProps> = ({ initialReport, processedFiles, onAnalyzeOther, logError }) => {
  const [report, setReport] = useState<GeneratedReport>(initialReport);
  const [view, setView] = useState<DashboardView>('analysis');
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  
  const [comparativeReport, setComparativeReport] = useState<ComparativeAnalysisReport | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const [isFullTextLoading, setIsFullTextLoading] = useState(false);
  const [fullTextError, setFullTextError] = useState<string | null>(null);

  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const handleSelectView = useCallback(async (selectedView: DashboardView) => {
    setView(selectedView);
    if (selectedView === 'fullText' && !report.fullTextAnalysis && !isFullTextLoading) {
      setIsFullTextLoading(true);
      setFullTextError(null);
      setProgressMessage('Iniciando análise profunda...');
      try {
        const fullText = await generateFullTextAnalysis(processedFiles, logError, setProgressMessage);
        setReport(prev => ({ ...prev!, fullTextAnalysis: fullText }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Falha ao carregar a análise completa.";
        setFullTextError(errorMessage);
        logError({ source: 'Dashboard.FullText', message: errorMessage, severity: 'critical', details: err });
      } finally {
        setIsFullTextLoading(false);
        setProgressMessage(null);
      }
    }
  }, [report.fullTextAnalysis, isFullTextLoading, processedFiles, logError]);


  const handleStartComparison = useCallback(async () => {
    if (isComparing || processedFiles.length < 2) return;
    
    setIsComparing(true);
    setComparisonError(null);
    setComparativeReport(null);
    setProgressMessage('Iniciando análise comparativa...');

    try {
      const result = await generateComparativeAnalysis(processedFiles, logError, setProgressMessage);
      setComparativeReport(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido na comparação.';
      setComparisonError(errorMessage);
      logError({
        source: 'ComparativeAnalysis',
        message: errorMessage,
        severity: 'critical',
        details: err,
      });
    } finally {
      setIsComparing(false);
      setProgressMessage(null);
    }
  }, [processedFiles, isComparing, logError]);


  const TabButton: React.FC<{
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
  }> = ({ label, icon, isActive, onClick }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold rounded-t-lg border-b-2 transition-all duration-300 ${
        isActive
          ? 'text-accent-light border-accent'
          : 'text-content-default border-transparent hover:text-white hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex justify-between items-center mb-4">
        {/* Tabs */}
        <div className="flex items-center border-b border-border-glass">
            <TabButton label="Análise Executiva" icon={<PaperIcon className="w-5 h-5"/>} isActive={view === 'analysis'} onClick={() => handleSelectView('analysis')} />
            <TabButton label="Simulador Tributário" icon={<CalculatorIcon className="w-5 h-5"/>} isActive={view === 'simulator'} onClick={() => handleSelectView('simulator')} />
            <TabButton label="Análise Comparativa" icon={<CompareIcon className="w-5 h-5"/>} isActive={view === 'comparison'} onClick={() => handleSelectView('comparison')} />
            <TabButton label="Análise Completa" icon={<FileTextIcon className="w-5 h-5"/>} isActive={view === 'fullText'} onClick={() => handleSelectView('fullText')} />
        </div>
        
        <button 
            onClick={onAnalyzeOther}
            className="bg-bg-secondary hover:bg-white/10 text-content-emphasis font-bold py-2 px-4 rounded-xl border border-border-glass transition-colors">
            Analisar Outros Arquivos
        </button>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3">
            {view === 'analysis' && <ExecutiveAnalysis summary={report.executiveSummary} />}
            {view === 'simulator' && <TaxSimulator report={report} onSimulationComplete={setSimulationResult} logError={logError} />}
            {view === 'comparison' && (
              <ComparativeAnalysis 
                files={processedFiles}
                onStart={handleStartComparison}
                isLoading={isComparing}
                error={comparisonError}
                report={comparativeReport}
                progressMessage={progressMessage}
              />
            )}
            {view === 'fullText' && (
                <FullTextAnalysis 
                    analysisText={report.fullTextAnalysis} 
                    isLoading={isFullTextLoading}
                    error={fullTextError}
                    progressMessage={progressMessage}
                />
            )}
        </div>
        <div className="lg:col-span-2">
            <InteractiveChat report={report} simulationResult={simulationResult} />
        </div>
      </div>
    </div>
  );
};
