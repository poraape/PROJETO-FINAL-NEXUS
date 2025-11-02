import React, { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { Header } from './components/Header.tsx';
import { FileUpload } from './components/FileUpload.tsx';
import { PipelineTracker } from './components/PipelineTracker.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import { ErrorLogModal } from './components/ErrorLogModal.tsx';
import { INITIAL_PIPELINE_STEPS } from './constants.ts';
import { generateReportFromFiles } from './services/geminiService.ts';
import { GeneratedReport, PipelineStep, ProcessingStepStatus, Theme } from './types.ts';
import { useErrorLog } from './hooks/useErrorLog.ts';

type View = 'upload' | 'processing' | 'dashboard';

function App() {
  const [view, setView] = useState<View>('upload');
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>(INITIAL_PIPELINE_STEPS);
  const [error, setError] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  const [processedFiles, setProcessedFiles] = useState<File[]>([]);
  const [theme, setTheme] = useState<Theme>('dark');
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);
  const { logError } = useErrorLog();

  useEffect(() => {
    document.body.classList.toggle('light-theme', theme === 'light');
  }, [theme]);

  const updatePipelineStep = useCallback((index: number, status: ProcessingStepStatus) => {
    setPipelineSteps(prevSteps => {
      const newSteps = [...prevSteps];
      for (let i = 0; i < index; i++) {
        newSteps[i] = { ...newSteps[i], status: ProcessingStepStatus.COMPLETED };
      }
      newSteps[index] = { ...newSteps[index], status };
      return newSteps;
    });
  }, []);
  
  const handleFileUpload = async (files: File[]) => {
    if (view === 'processing') return;

    setError(null);
    setUploadInfo('Processando arquivos...');
    setView('processing');
    setGeneratedReport(null);
    setProcessedFiles([]);
    setPipelineSteps(INITIAL_PIPELINE_STEPS);

    let currentProcessedFiles: File[] = [];
    let extractedCount = 0;

    try {
      setUploadInfo('Preparando arquivos para análise...');
      const fileProcessingPromises = files.map(async (file) => {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const zip = await JSZip.loadAsync(file);
          const extractedFilePromises: Promise<File>[] = [];
          
          zip.forEach((_, zipEntry) => {
            if (!zipEntry.dir) {
              const promise = zipEntry.async('blob').then(blob => {
                extractedCount++;
                return new File([blob], zipEntry.name, { type: blob.type });
              });
              extractedFilePromises.push(promise);
            }
          });
          
          return Promise.all(extractedFilePromises);
        } else {
          return Promise.resolve([file]);
        }
      });

      const nestedFilesArray = await Promise.all(fileProcessingPromises);
      currentProcessedFiles = nestedFilesArray.flat();
      setProcessedFiles(currentProcessedFiles);
      
      if (currentProcessedFiles.length === 0) {
        throw new Error('Nenhum arquivo válido encontrado para análise. O arquivo .zip pode estar vazio ou conter apenas pastas.');
      }
      
      if (extractedCount > 0) {
        setUploadInfo(`${extractedCount} arquivo${extractedCount > 1 ? 's' : ''} extraído${extractedCount > 1 ? 's' : ''} de arquivos .zip. Analisando ${currentProcessedFiles.length} arquivo${currentProcessedFiles.length > 1 ? 's' : ''} no total.`);
      } else {
        setUploadInfo(`Analisando ${currentProcessedFiles.length} arquivo${currentProcessedFiles.length > 1 ? 's' : ''}...`);
      }
      
      const report = await generateReportFromFiles(currentProcessedFiles, (stepIndex) => {
        updatePipelineStep(stepIndex, ProcessingStepStatus.IN_PROGRESS);
      });
      
      updatePipelineStep(INITIAL_PIPELINE_STEPS.length - 1, ProcessingStepStatus.COMPLETED);
      setGeneratedReport(report);
      setView('dashboard');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(errorMessage);
      logError({
          source: 'FileUpload',
          message: errorMessage,
          severity: 'critical',
          details: err instanceof Error ? err.stack : JSON.stringify(err)
      });
      const currentStepIndex = pipelineSteps.findIndex(s => s.status === ProcessingStepStatus.IN_PROGRESS);
      if (currentStepIndex !== -1) {
        updatePipelineStep(currentStepIndex, ProcessingStepStatus.FAILED);
      } else {
        setPipelineSteps(prev => prev.map(step => ({ ...step, status: ProcessingStepStatus.FAILED })));
      }
      setTimeout(() => setView('upload'), 3000);
      console.error("Failed to process files or generate report:", err);
    }
  };

  const handleAnalyzeOtherFiles = () => {
    setView('upload');
    setGeneratedReport(null);
    setError(null);
    setUploadInfo(null);
    setProcessedFiles([]);
    setPipelineSteps(INITIAL_PIPELINE_STEPS);
  };
  
  const renderContent = () => {
    const commonWrapperClasses = "min-h-[calc(100vh-80px)] flex flex-col items-center justify-center p-4";
    switch(view) {
      case 'upload':
        return (
          <div className={commonWrapperClasses}>
            <FileUpload onFileUpload={handleFileUpload} error={error} />
          </div>
        );
      case 'processing':
         return (
          <div className={commonWrapperClasses}>
            <PipelineTracker steps={pipelineSteps} info={uploadInfo} />
            {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
          </div>
        );
      case 'dashboard':
        if (generatedReport) {
          return <Dashboard report={generatedReport} processedFiles={processedFiles} onAnalyzeOther={handleAnalyzeOtherFiles} />;
        }
        return null;
      default:
        return null;
    }
  };
  
  return (
    <div className="text-content-default min-h-screen font-sans">
      <Header 
        onLogoClick={handleAnalyzeOtherFiles}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onOpenErrorLog={() => setIsErrorLogOpen(true)}
      />
      <main>
        {renderContent()}
      </main>
      <ErrorLogModal isOpen={isErrorLogOpen} onClose={() => setIsErrorLogOpen(false)} />
    </div>
  );
}

export default App;
