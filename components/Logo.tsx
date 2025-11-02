import React from 'react';

interface LogoProps {
  onLogoClick: () => void;
}

export const Logo: React.FC<LogoProps> = ({ onLogoClick }) => {
  return (
    <div onClick={onLogoClick} className="flex items-center space-x-3 cursor-pointer">
        <div className="w-10 h-10 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#81E6D9" />
                        <stop offset="100%" stopColor="#3B82F6" />
                    </linearGradient>
                </defs>
                <path d="M8 35 V5 H15 L25 35 H32 V5 H25 L15 35 H8 Z" fill="url(#logo-grad)" />
            </svg>
        </div>
        <div>
            <h1 className="text-2xl font-bold">
                <span className="bg-gradient-to-r from-accent-light to-blue-500 text-transparent bg-clip-text">
                Nexus QuantumI2A2
                </span>
            </h1>
            <p className="text-xs text-content-default -mt-1">
                Interactive Insight & Intelligence from Fiscal Analysis
            </p>
        </div>
    </div>
  );
};