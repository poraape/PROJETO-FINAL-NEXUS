import { PipelineStep, ProcessingStepStatus } from './types.ts';

export const INITIAL_PIPELINE_STEPS: PipelineStep[] = [
  { name: '1. Extração de Dados', status: ProcessingStepStatus.PENDING },
  { name: '2. Validação de Dados', status: ProcessingStepStatus.PENDING },
  { name: '3. Auditoria Inicial', status: ProcessingStepStatus.PENDING },
  { name: '4. Classificação Fiscal', status: ProcessingStepStatus.PENDING },
  { name: '5. Análise Executiva (IA)', status: ProcessingStepStatus.PENDING },
  { name: '6. Indexação Cognitiva', status: ProcessingStepStatus.PENDING },
];
