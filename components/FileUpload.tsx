import React, { useState, useCallback, useRef } from 'react';
import { UploadIcon } from './icons/UploadIcon';

interface FileUploadProps {
  onFileUpload: (files: File[]) => void;
  error?: string | null;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, error }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files && files.length > 0) {
      onFileUpload(files);
    }
  }, [onFileUpload]);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
     if (files && files.length > 0) {
      onFileUpload(files);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full max-w-2xl bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-8 flex flex-col items-center">
        <h2 className="text-2xl font-semibold text-content-emphasis mb-6">Central de Upload de Documentos</h2>
        
        {error && (
            <div className="w-full p-3 mb-4 bg-red-500/20 border border-red-500/50 rounded-xl text-center">
                <p className="text-sm text-red-300">{error}</p>
            </div>
        )}

        <div
            className={`w-full p-10 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300
            ${isDragging ? 'border-accent bg-accent/10 scale-105' : 'border-border-glass hover:border-accent/70 hover:bg-white/5'}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={handleClick}
        >
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                className="hidden"
                accept=".xml,.pdf,.csv,.xlsx,.png,.jpg,.jpeg,.zip,application/zip,application/x-zip-compressed"
            />
            <div className="flex flex-col items-center text-center">
                <UploadIcon className="w-12 h-12 text-content-default mb-4" />
                <p className="text-lg font-semibold text-accent-light">Clique ou arraste novos arquivos</p>
                <p className="text-sm text-content-default mt-2">Arquivos .zip serão extraídos. Suporte para XML, PDF, CSV e mais (limite de 200MB).</p>
            </div>
        </div>
        <a href="#" className="text-sm text-gray-500 hover:text-accent-light mt-6 underline transition-colors">
            Não tem um arquivo? Use um exemplo de demonstração.
        </a>
    </div>
  );
};