import { PipelineStep, ProcessingStepStatus } from './types.ts';

export const INITIAL_PIPELINE_STEPS: PipelineStep[] = [
  { name: '1. Extração e Leitura', status: ProcessingStepStatus.PENDING },
  { name: '2. Ag. Auditor', status: ProcessingStepStatus.PENDING },
  { name: '3. Ag. Classificador', status: ProcessingStepStatus.PENDING },
  { name: '4. Ag. Inteligência', status: ProcessingStepStatus.PENDING },
  { name: '5. Ag. Contador', status: ProcessingStepStatus.PENDING },
];