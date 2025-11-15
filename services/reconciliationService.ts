import { buildBackendHttpUrl } from '../config.ts';
import { authorizedFetch } from './httpClient.ts';
import { ReconciliationResult } from '../types.ts';

export async function conciliarExtratos(jobId: string, files: File[]): Promise<ReconciliationResult> {
    if (!jobId) {
        throw new Error('JobId inválido para conciliação.');
    }
    if (!files.length) {
        throw new Error('Nenhum arquivo foi selecionado para conciliação.');
    }

    const formData = new FormData();
    files.forEach((file) => formData.append('statements', file));

    const response = await authorizedFetch(buildBackendHttpUrl(`/api/jobs/${jobId}/reconciliation`), {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Falha ao executar a conciliação bancária.');
    }

    return response.json();
}
