import React, { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { Header } from './components/Header.tsx';
import { FileUpload } from './components/FileUpload.tsx';
import { PipelineTracker } from './components/PipelineTracker.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import { ErrorLogModal } from './components/ErrorLogModal.tsx';
import { INITIAL_PIPELINE_STEPS } from './constants.ts';
import { generateReportFromFiles, getFileContentForAnalysis, getFullContentForIndexing } from './services/geminiService.ts';
import { GeneratedReport, PipelineStep, ProcessingStepStatus, Theme } from './types.ts';
import { useErrorLog } from './hooks/useErrorLog.ts';
import { clearContext, getLastReportSummary, storeLastReportSummary, createAndStoreIndex, storeForecast } from './services/contextMemory.ts';
import { extrairDadosParaExportacao } from './services/exporter.ts';
import { classificarNotas } from './services/classifier.ts';
import { calcularPrevisoes } from './services/forecast.ts';
import { iniciarAuditoriaAutomatica } from './services/auditorAgent.ts';

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

  useEffect(() => {
    const initializeApp = () => {
        iniciarAuditoriaAutomatica();
        console.log("[App Init] Application ready. API key is expected from environment.");
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

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const validFiles: File[] = [];
    let oversizedFiles: string[] = [];
    const errorMessages: string[] = [];
    
    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            oversizedFiles.push(file.name);
        } else {
            validFiles.push(file);
        }
    }

    if (oversizedFiles.length > 0) {
        const oversizedMsg = `Os seguintes arquivos são muito grandes (limite de 10MB) e não serão processados: ${oversizedFiles.join(', ')}`;
        errorMessages.push(oversizedMsg);
        logError({
            source: 'FileUpload',
            message: `Arquivos excedem o limite de 10MB: ${oversizedFiles.join(', ')}`,
            severity: 'warning'
        });
    }

    if (validFiles.length === 0) {
        setError(errorMessages.length > 0 ? errorMessages.join('\n') : "Nenhum arquivo válido para processar. Verifique o tamanho dos arquivos.");
        setView('upload');
        return;
    }

    let currentProcessedFiles: File[] = [];

    try {
      setUploadInfo('Preparando arquivos para análise...');
      const fileProcessingPromises = validFiles.map(async (file) => {
        if (file.name.toLowerCase().endsWith('.zip')) {
          try {
            const zip = await JSZip.loadAsync(file);
            const extractedFilePromises: Promise<File | null>[] = [];
            
            zip.forEach((_, zipEntry) => {
              if (!zipEntry.dir) {
                const promise = zipEntry.async('blob').then(blob => {
                  const extractedFile = new File([blob], zipEntry.name, { type: blob.type });
                  if (extractedFile.size > MAX_FILE_SIZE) {
                      oversizedFiles.push(`(do zip) ${extractedFile.name}`);
                      return null;
                  }
                  return extractedFile;
                });
                extractedFilePromises.push(promise);
              }
            });
            
            const extractedFiles = await Promise.all(extractedFilePromises);
            return extractedFiles.filter((f): f is File => f !== null);

          } catch (zipError) {
              console.error(`Error unzipping ${file.name}:`, zipError);
              throw new Error(`Falha ao descompactar o arquivo '${file.name}'. O arquivo pode estar corrompido ou em um formato de zip não suportado.`);
          }
        } else {
          return Promise.resolve([file]);
        }
      });

      const nestedFilesArray = await Promise.all(fileProcessingPromises);
      currentProcessedFiles = nestedFilesArray.flat();
      setProcessedFiles(currentProcessedFiles);
       
      if (oversizedFiles.length > 0) {
          const oversizedMsg = `Arquivos grandes (limite de 10MB) ignorados: ${oversizedFiles.join(', ')}`;
          setError(oversizedMsg);
          logError({
            source: 'FileUpload',
            message: `Arquivos extraídos excedem o limite de 10MB: ${oversizedFiles.join(', ')}`,
            severity: 'warning'
        });
      }

      if (currentProcessedFiles.length === 0) {
        let finalError = 'Nenhum arquivo válido encontrado para análise.';
        if(oversizedFiles.length > 0) {
            finalError += ` ${oversizedFiles.length} arquivo(s) foram ignorados por excederem o limite de tamanho.`
        } else if (files.some(f => f.name.toLowerCase().endsWith('.zip'))) {
            finalError += ' O arquivo .zip pode estar vazio ou conter apenas pastas.'
        }
        throw new Error(finalError);
      }
      
      setUploadInfo(`Analisando ${currentProcessedFiles.length} arquivo(s)...`);
      
      updatePipelineStep(0, ProcessingStepStatus.IN_PROGRESS, "Extraindo dados estruturados...");
      const { documentos } = await extrairDadosParaExportacao(currentProcessedFiles);
      
      try {
          logError({ source: 'Forecast', message: 'Calculando previsões...', severity: 'info' });
          const forecast = calcularPrevisoes(documentos);
          if (forecast) {
              storeForecast(forecast);
              logError({ source: 'Forecast', message: 'Previsões calculadas e armazenadas.', severity: 'info' });
          }
      } catch (err) {
          logError({ source: 'Forecast', message: 'Falha no cálculo das previsões.', severity: 'warning', details: err });
      }

      const fileContentsForAnalysis = await getFileContentForAnalysis(currentProcessedFiles, updatePipelineStep, logError);
      updatePipelineStep(0, ProcessingStepStatus.COMPLETED);

      updatePipelineStep(1, ProcessingStepStatus.IN_PROGRESS, "Ag. Auditor: Verificando consistência...");
      await new Promise(res => setTimeout(res, 300));
      updatePipelineStep(1, ProcessingStepStatus.COMPLETED);

      updatePipelineStep(2, ProcessingStepStatus.IN_PROGRESS, "Ag. Classificador: Organizando informações...");
      const classifications = await classificarNotas(documentos, logError);
      updatePipelineStep(2, ProcessingStepStatus.COMPLETED);

      updatePipelineStep(3, ProcessingStepStatus.IN_PROGRESS, "Ag. Inteligência: Gerando análise executiva...");
      const executiveSummary = await generateReportFromFiles(fileContentsForAnalysis, classifications, logError);
      updatePipelineStep(3, ProcessingStepStatus.COMPLETED);
      
      storeLastReportSummary(executiveSummary);

      try {
          updatePipelineStep(4, ProcessingStepStatus.IN_PROGRESS, "Ag. Contador: Indexando conteúdo para chat...");
          const indexingContents = await getFullContentForIndexing(currentProcessedFiles, logError);
          createAndStoreIndex(indexingContents);
          updatePipelineStep(4, ProcessingStepStatus.COMPLETED, "Indexação concluída!");
      } catch (err) {
          logError({ source: 'App.Indexing', message: 'Falha ao indexar conteúdo para o chat. O chat pode não ter contexto.', severity: 'warning', details: err });
           updatePipelineStep(4, ProcessingStepStatus.COMPLETED, "Indexação com avisos.");
      }

      const initialReport: GeneratedReport = { executiveSummary, fullTextAnalysis: undefined };
      setGeneratedReport(initialReport);
      setView('dashboard');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      let displayError = errorMessage;
      
      if (errorMessage.toLowerCase().includes("api key") || errorMessage.toLowerCase().includes("api_key")) {
        displayError = 'Sua chave da API configurada no ambiente é inválida ou expirou. Verifique a configuração e atualize a página.';
        logError({
            source: 'GeminiService',
            message: 'A chave da API fornecida no ambiente é inválida ou expirou.',
            severity: 'critical',
            details: err,
        });
      }

      setError(prev => prev ? `${prev}\n${displayError}` : displayError);
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
        updatePipelineStep(0, ProcessingStepStatus.FAILED);
      }
      setTimeout(() => setView('upload'), 3000);
      console.error("Failed to process files or generate report:", err);
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
            <PipelineTracker steps={pipelineSteps} />
            {error && <p className="text-red-400 mt-4 text-center max-w-2xl whitespace-pre-wrap bg-red-500/10 p-3 rounded-lg">{error}</p>}
          </div>
        );
      case 'dashboard':
        if (generatedReport) {
          return <Dashboard initialReport={generatedReport} processedFiles={processedFiles} onAnalyzeOther={handleAnalyzeOtherFiles} logError={logError} />;
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
