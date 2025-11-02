

import React from 'react';
import { PipelineStep, ProcessingStepStatus } from '../types.ts';
import { CheckCircleIcon } from './icons/CheckCircleIcon.tsx';
import { ProcessingIcon } from './icons/ProcessingIcon.tsx';
import { InfoIcon } from './icons/InfoIcon.tsx';

interface PipelineTrackerProps {
  steps: PipelineStep[];
  info?: string | null;
}

const StatusIcon: React.FC<{ status: ProcessingStepStatus }> = ({ status }) => {
  if (status === ProcessingStepStatus.COMPLETED) {
    return <CheckCircleIcon className="w-8 h-8 text-accent" />;
  }
  if (status === ProcessingStepStatus.IN_PROGRESS) {
    return <ProcessingIcon />;
  }
   if (status === ProcessingStepStatus.FAILED) {
    return (
        <div className="w-8 h-8 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </div>
    );
  }
  return (
      <div className="w-8 h-8 rounded-full bg-white/5 border-2 border-border-glass"></div>
  );
};

export const PipelineTracker: React.FC<PipelineTrackerProps> = ({ steps, info }) => {
  const currentStepInfo = steps.find(step => step.status === ProcessingStepStatus.IN_PROGRESS)?.name || "Preparando análise...";
  
  return (
    <div className="w-full max-w-3xl bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-8">
      <h2 className="text-2xl font-semibold text-content-emphasis mb-8 text-center">Progresso da Análise</h2>

      {info && (
        <div className="w-full p-3 mb-6 bg-blue-500/20 border border-blue-500/50 rounded-xl text-center flex items-center justify-center gap-2">
            <InfoIcon className="w-5 h-5 text-blue-300 flex-shrink-0" />
            <p className="text-sm text-blue-200">{info}</p>
        </div>
      )}

      <div className="flex justify-between items-center">
        {steps.map((step, index) => (
          <React.Fragment key={index}>
            <div className="flex flex-col items-center text-center">
              <StatusIcon status={step.status} />
              <p className={`mt-2 text-sm font-semibold ${step.status !== ProcessingStepStatus.PENDING ? 'text-content-emphasis' : 'text-content-default/50'}`}>
                {step.name}
              </p>
            </div>
            {index < steps.length - 1 && (
              <div className={`flex-1 h-1 mx-2 rounded ${step.status === ProcessingStepStatus.COMPLETED ? 'bg-accent' : 'bg-white/10'}`}></div>
            )}
          </React.Fragment>
        ))}
      </div>
       <p className="text-center text-content-default mt-8 animate-pulse">{currentStepInfo}...</p>
    </div>
  );
};