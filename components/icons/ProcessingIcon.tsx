import React from 'react';

export const ProcessingIcon: React.FC = () => (
    <div className="relative w-8 h-8 flex items-center justify-center">
        <div className="absolute w-full h-full rounded-full bg-accent/50 animate-pulse-ring"></div>
        <div className="w-5 h-5 rounded-full bg-accent"></div>
    </div>
);