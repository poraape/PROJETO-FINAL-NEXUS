import React, { useState, useCallback } from 'react';
import { GeneratedReport, SimulationResult, ComparativeAnalysisReport } from '../../types.ts';
import { ExecutiveAnalysis } from './ExecutiveAnalysis.tsx';
import { InteractiveChat } from './InteractiveChat.tsx';
import { TaxSimulator } from './TaxSimulator.tsx';
import { PaperIcon } from '../icons/PaperIcon.tsx';
import { CalculatorIcon } from '../icons/CalculatorIcon.tsx';
import { FileTextIcon } from '../icons/FileTextIcon.tsx';
import { FullTextAnalysis } from './FullTextAnalysis.tsx';
import { CompareIcon } from '../icons/CompareIcon.tsx';
import { ComparativeAnalysis } from './ComparativeAnalysis.tsx';
import { generateComparativeAnalysis } from '../../services/geminiService.ts';

interface DashboardProps {
  report: GeneratedReport;
  processedFiles: File[];
  onAnalyzeOther: () => void;
}

type DashboardView = 'analysis' | 'simulator' | 'fullText' | 'comparison';

export const Dashboard: React.FC<DashboardProps> = ({ report, processedFiles, onAnalyzeOther }) => {
  const [view, setView] = useState<DashboardView>('analysis');
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  
  const [comparativeReport, setComparativeReport] = useState<ComparativeAnalysisReport | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const handleStartComparison = useCallback(async () => {
    if (isComparing || processedFiles.length < 2) return;
    
    setIsComparing(true);
    setComparisonError(null);
    setComparativeReport(null);
    
    try {
      const result = await generateComparativeAnalysis(processedFiles);
      setComparativeReport(result);
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
    } finally {
      setIsComparing(false);
    }
  }, [processedFiles, isComparing]);


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
            <TabButton label="Análise Executiva" icon={<PaperIcon className="w-5 h-5"/>} isActive={view === 'analysis'} onClick={() => setView('analysis')} />
            <TabButton label="Simulador Tributário" icon={<CalculatorIcon className="w-5 h-5"/>} isActive={view === 'simulator'} onClick={() => setView('simulator')} />
            <TabButton label="Análise Comparativa" icon={<CompareIcon className="w-5 h-5"/>} isActive={view === 'comparison'} onClick={() => setView('comparison')} />
            <TabButton label="Análise Completa" icon={<FileTextIcon className="w-5 h-5"/>} isActive={view === 'fullText'} onClick={() => setView('fullText')} />
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
            {view === 'simulator' && <TaxSimulator report={report} onSimulationComplete={setSimulationResult} />}
            {view === 'comparison' && (
              <ComparativeAnalysis 
                files={processedFiles}
                onStart={handleStartComparison}
                isLoading={isComparing}
                error={comparisonError}
                report={comparativeReport}
              />
            )}
            {view === 'fullText' && <FullTextAnalysis analysisText={report.fullTextAnalysis} />}
        </div>
        <div className="lg:col-span-2">
            <InteractiveChat report={report} simulationResult={simulationResult} />
        </div>
      </div>
    </div>
  );
};