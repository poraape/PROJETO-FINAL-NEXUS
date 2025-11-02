import React from 'react';
import { FileTextIcon } from '../icons/FileTextIcon';

interface FullTextAnalysisProps {
  analysisText: string;
}

export const FullTextAnalysis: React.FC<FullTextAnalysisProps> = ({ analysisText }) => {
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
      <div className="flex-1 overflow-y-auto pr-2 text-content-default leading-relaxed bg-black/20 rounded-xl p-4 border border-border-glass">
         <p className="whitespace-pre-wrap font-mono text-sm">
            {analysisText}
         </p>
      </div>
    </div>
  );
};