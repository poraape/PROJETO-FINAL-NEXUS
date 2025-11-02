import React, { useState, useCallback } from 'react';
import { UploadIcon } from './icons/UploadIcon.tsx';

interface FileUploadProps {
  onFileUpload: (files: File[]) => void;
  error: string | null;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, error }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      onFileUpload(files);
    }
  }, [onFileUpload]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length > 0) {
      onFileUpload(files);
    }
  };

  return (
    <div className="w-full max-w-3xl text-center">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center w-full p-12 border-2 border-dashed rounded-3xl transition-colors duration-300 ${isDragOver ? 'border-accent bg-accent/10' : 'border-border-glass bg-bg-secondary/50'}`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-bg-secondary via-transparent to-bg-secondary opacity-50 backdrop-blur-sm rounded-3xl"></div>
        <div className="relative z-10 flex flex-col items-center">
            <div className="bg-accent/20 p-4 rounded-full mb-4">
                <UploadIcon className="w-12 h-12 text-accent" />
            </div>
            <h2 className="text-3xl font-bold text-content-emphasis mb-2">Arraste e Solte Seus Arquivos Fiscais</h2>
            <p className="text-content-default mb-6">SPED, NF-e, XML, CSV, JSON, PDF, DOCX, XLSX, imagens ou arquivos .ZIP.</p>
            <label htmlFor="file-upload" className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl transition-colors">
                Ou Selecione os Arquivos
            </label>
            <input 
              id="file-upload" 
              type="file" 
              multiple 
              className="hidden" 
              onChange={handleFileChange} 
              accept=".xml,.csv,.txt,.zip,.json,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/webp" 
            />
        </div>
      </div>
      {error && (
        <p className="mt-4 text-red-400 bg-red-500/10 p-3 rounded-lg whitespace-pre-wrap">{error}</p>
      )}
    </div>
  );
};
