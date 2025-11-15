import React, { useState, useCallback, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { FileUpload } from './components/FileUpload.tsx';
import { PipelineTracker } from './components/PipelineTracker.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import { ErrorLogModal } from './components/ErrorLogModal.tsx';
import { INITIAL_PIPELINE_STEPS } from './constants.ts';
import { GeneratedReport, PipelineStep, ProcessingStepStatus, Theme } from './types.ts';
import { useErrorLog } from './hooks/useErrorLog.ts';
import {
  clearContext,
  getLastReportSummary,
  getLastGeneratedReport,
  storeLastGeneratedReport,
} from './services/contextMemory.ts';
import { iniciarAuditoriaAutomatica } from './services/auditorAgent.ts';
import { buildBackendHttpUrl, buildBackendWsUrl } from './config.ts';
import { authorizedFetch } from './services/httpClient.ts';

type View = 'upload' | 'processing' | 'dashboard';

function App() {
  const [view, setView] = useState<View>('upload');
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>(INITIAL_PIPELINE_STEPS);
  const [error, setError] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReport | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [processedFiles, setProcessedFiles] = useState<File[]>([]);
  const [theme, setTheme] = useState<Theme>('dark');
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);
  const { logError } = useErrorLog();
  
  useEffect(() => {
    document.body.classList.toggle('light-theme', theme === 'light');
  }, [theme]);

  useEffect(() => {
    const initializeApp = () => {
        iniciarAuditoriaAutomatica();
        console.log('[App Init] Application ready. Using authenticated session token.');
        const lastReport = getLastGeneratedReport();
        if (lastReport) {
            setGeneratedReport(lastReport);
            setUploadInfo("Sessão anterior restaurada a partir da memória cognitiva.");
            setView('dashboard');
            return;
        }
        const lastSummary = getLastReportSummary();
        if (lastSummary) {
            setGeneratedReport({ executiveSummary: lastSummary, fullTextAnalysis: undefined });
            setUploadInfo("Sessão anterior restaurada a partir da memória cognitiva.");
            setView('dashboard');
        }
    };
    initializeApp();
  }, []);

  const updatePipelineStep = useCallback((index: number, status: ProcessingStepStatus, info?: string) => {
    setPipelineSteps(prevSteps => {
      const newSteps = [...prevSteps].map((step, i) => {
        if (i < index) {
          return { ...step, status: ProcessingStepStatus.COMPLETED, info: undefined };
        }
        if (i === index) {
          return { ...step, status, info: info || step.info };
        }
        return { ...step, status: ProcessingStepStatus.PENDING, info: undefined };
      });
      return newSteps;
    });
  }, []);
  
  const handleFileUpload = async (files: File[]) => {
    if (view === 'processing') return;

    clearContext();
    setError(null);
    setUploadInfo('Processando arquivos...');
    setView('processing');
    setGeneratedReport(null);
    setProcessedFiles([]);
    setPipelineSteps(INITIAL_PIPELINE_STEPS);
    setProcessedFiles(files);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      // 1. Inicia o job no backend
      const response = await authorizedFetch(buildBackendHttpUrl('/api/jobs'), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Falha ao iniciar o job de processamento.');
      }

      const { jobId } = await response.json();
      setCurrentJobId(jobId);
      setUploadInfo(`Job ${jobId} iniciado. Acompanhando progresso...`);

      // 2. Conecta via WebSocket para receber atualizações em tempo real
      // O servidor de desenvolvimento do React geralmente roda em uma porta diferente (ex: 5173)
      // do nosso backend (3001). Em produção, eles estariam no mesmo host.
      const wsUrl = buildBackendWsUrl('/', { jobId });
      const ws = new WebSocket(wsUrl);
      let jobFinalized = false;

      ws.onmessage = (event) => {
        const jobStatus = JSON.parse(event.data);
        setPipelineSteps(jobStatus.pipeline);

        if (jobStatus.status === 'completed') {
          if (jobStatus.result) {
            setGeneratedReport(jobStatus.result);
            storeLastGeneratedReport(jobStatus.result);
          }
          setView('dashboard');
          jobFinalized = true;
          ws.close();
        } else if (jobStatus.status === 'failed') {
          jobFinalized = true;
          ws.close();
          throw new Error(jobStatus.error || 'O job de processamento falhou no backend.');
        }
      };

      ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        setError("Erro de comunicação com o servidor. Tente novamente.");
        setView('upload');
      };

      ws.onclose = (event) => {
        console.log("WebSocket connection closed:", event.reason);
        // Se a conexão fechar inesperadamente antes do job terminar
        if (!jobFinalized) {
            setError("A conexão com o servidor foi perdida.");
            setView('upload');
            setCurrentJobId(null);
        }
      };

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
      setError(errorMessage);
      logError({
        source: 'JobSubmission',
        message: errorMessage,
        severity: 'critical',
        details: err instanceof Error ? err.stack : JSON.stringify(err),
      });
      updatePipelineStep(0, ProcessingStepStatus.FAILED);
      setView('upload');
      setCurrentJobId(null);
    }
  };

  const handleAnalyzeOtherFiles = () => {
    clearContext();
    setView('upload');
    setGeneratedReport(null);
    setError(null);
    setUploadInfo(null);
    setProcessedFiles([]);
    setPipelineSteps(INITIAL_PIPELINE_STEPS);
    setCurrentJobId(null);
  };
  
  const renderContent = () => {
    const commonWrapperClasses = "min-h-[calc(100vh-80px)] flex flex-col items-center justify-center p-4";
    switch(view) {
      case 'upload':
        return (
          <div className={commonWrapperClasses}>
            <section className="text-center mb-12 px-4 animate-subtle-bob">
                <p className="text-content-default leading-relaxed max-w-3xl mx-auto">
                    Nexus QuantumI2A2 é um ecossistema inteligente de análise e decisão fiscal que combina processamento automatizado, inteligência adaptativa e visão estratégica. Integrando múltiplas camadas de IA, o sistema transforma dados fiscais complexos em conhecimento acionável — oferecendo precisão analítica, automação contínua e insights que evoluem com o contexto tributário.
                </p>
                <p className="text-content-emphasis font-medium mt-4 max-w-3xl mx-auto">
                    Inovação, clareza e inteligência conectada — o futuro da análise fiscal começa aqui.
                </p>
            </section>
            <FileUpload onFileUpload={handleFileUpload} error={error} />
          </div>
        );
      case 'processing':
         return (
          <div className={commonWrapperClasses}>
            <PipelineTracker steps={pipelineSteps} uploadInfo={uploadInfo} />
            {error && <p className="text-red-400 mt-4 text-center max-w-2xl whitespace-pre-wrap bg-red-500/10 p-3 rounded-lg">{error}</p>}
          </div>
        );
      case 'dashboard':
        if (generatedReport) {
          return <Dashboard jobId={currentJobId} initialReport={generatedReport} processedFiles={processedFiles} onAnalyzeOther={handleAnalyzeOtherFiles} logError={logError} />;
        }
        return (
             <div className={commonWrapperClasses}>
                <p>Restaurando sessão...</p>
             </div>
        );
      default:
        return null;
    }
  };
  
  return (
    <div className="text-content-default min-h-screen font-sans">
      <>
        <Header 
          onLogoClick={handleAnalyzeOtherFiles}
          theme={theme}
          onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          onOpenErrorLog={() => setIsErrorLogOpen(true)}
          processedFiles={view === 'dashboard' ? processedFiles : []}
          jobId={currentJobId}
        />
        <main>
          {renderContent()}
        </main>
        <ErrorLogModal isOpen={isErrorLogOpen} onClose={() => setIsErrorLogOpen(false)} />
      </>
    </div>
  );
}

export default App;
