import React from 'react';
import { FileTextIcon } from '../icons/FileTextIcon';
import { ProcessingIcon } from '../icons/ProcessingIcon.tsx';

interface FullTextAnalysisProps {
  analysisText?: string | null;
  isLoading: boolean;
  error: string | null;
  progressMessage?: string | null;
}

export const FullTextAnalysis: React.FC<FullTextAnalysisProps> = ({ analysisText, isLoading, error, progressMessage }) => {
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-content-default">
          <ProcessingIcon />
          <p className="mt-4 text-lg animate-pulse">{progressMessage || 'Gerando análise textual completa...'}</p>
          <p className="text-sm">{progressMessage ? 'Isso pode levar alguns instantes.' : 'Aguarde...'}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-red-400">
           <p className="text-lg">Falha ao carregar análise</p>
           <p className="text-sm mt-2 p-4 bg-red-500/10 rounded-lg">{error}</p>
        </div>
      );
    }
    
    if (analysisText) {
       return (
         <div className="flex-1 overflow-y-auto pr-2 text-content-default leading-relaxed bg-black/20 rounded-xl p-4 border border-border-glass">
            <p className="whitespace-pre-wrap font-mono text-sm">
                {analysisText}
            </p>
         </div>
       );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full text-content-default">
             <p>Nenhuma análise textual disponível.</p>
        </div>
    );
  };

  return (
    <div className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-6 h-full flex flex-col">
      <div className="flex items-center mb-6 flex-shrink-0">
        <div className="bg-purple-500/20 p-3 rounded-xl mr-4">
            <FileTextIcon className="w-6 h-6 text-purple-300" />
        </div>
        <div>
            <h2 className="text-2xl font-bold text-content-emphasis">Análise Textual Completa</h2>
            <p className="text-content-default">Detalhes completos gerados pela IA com base nos documentos.</p>
        </div>
      </div>
      {renderContent()}
    </div>
  );
};
