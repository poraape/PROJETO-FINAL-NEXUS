import React, { useState, useRef, useEffect } from 'react';
import { Logo } from './Logo.tsx';
import { DownloadIcon } from './icons/DownloadIcon.tsx';
import { SpedExportIcon } from './icons/SpedExportIcon.tsx';
import { BugIcon } from './icons/BugIcon.tsx';
import { SunIcon } from './icons/SunIcon.tsx';
import { MoonIcon } from './icons/MoonIcon.tsx';
import { Theme } from '../types.ts';
import { useErrorLog } from '../hooks/useErrorLog.ts';

interface HeaderProps {
  onLogoClick: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenErrorLog: () => void;
}

const ExportDropdown: React.FC = () => {
    // Placeholder functions
    const handleExport = (format: string) => alert(`Exportando como ${format}... (funcionalidade em desenvolvimento)`);
    
    return (
        <div className="absolute top-full right-0 mt-2 w-48 bg-bg-secondary-opaque rounded-xl border border-border-glass shadow-glass p-2 z-50">
            <button onClick={() => handleExport('PDF')} className="w-full text-left px-3 py-1.5 text-sm rounded-md text-content-default hover:bg-white/10">Exportar como PDF</button>
            <button onClick={() => handleExport('HTML')} className="w-full text-left px-3 py-1.5 text-sm rounded-md text-content-default hover:bg-white/10">Exportar como HTML</button>
            <button onClick={() => handleExport('DOCX')} className="w-full text-left px-3 py-1.5 text-sm rounded-md text-content-default hover:bg-white/10">Exportar como DOCX</button>
        </div>
    );
};

export const Header: React.FC<HeaderProps> = ({ onLogoClick, theme, onToggleTheme, onOpenErrorLog }) => {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { logs } = useErrorLog();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="flex items-center justify-between p-4 bg-bg-secondary/30 backdrop-blur-lg border-b border-border-glass sticky top-0 z-50 h-[80px]">
      <Logo onLogoClick={onLogoClick} />
      <div className="flex items-center space-x-2">
        
        {/* Export Dropdown */}
        <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsExportOpen(o => !o)} className="text-content-default hover:text-content-emphasis p-2 rounded-full bg-bg-secondary hover:bg-white/10 border border-border-glass">
                <DownloadIcon className="w-5 h-5"/>
            </button>
            {isExportOpen && <ExportDropdown />}
        </div>
        
        {/* SPED Export */}
        <button className="text-content-default hover:text-content-emphasis p-2 rounded-full bg-bg-secondary hover:bg-white/10 border border-border-glass">
            <SpedExportIcon className="w-5 h-5"/>
        </button>

        {/* Error Log */}
        <button onClick={onOpenErrorLog} className="relative text-content-default hover:text-content-emphasis p-2 rounded-full bg-bg-secondary hover:bg-white/10 border border-border-glass">
            <BugIcon className="w-5 h-5"/>
            {logs.length > 0 && (
                <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-bg-secondary-opaque text-[8px] flex items-center justify-center text-white">
                    {logs.length}
                </span>
            )}
        </button>

        {/* Theme Toggle */}
        <button onClick={onToggleTheme} className="text-content-default hover:text-content-emphasis p-2 rounded-full bg-bg-secondary hover:bg-white/10 border border-border-glass">
            {theme === 'dark' ? <SunIcon className="w-5 h-5"/> : <MoonIcon className="w-5 h-5"/>}
        </button>
      </div>
    </header>
  );
};
