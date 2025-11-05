// services/chatService.ts
import { LogError } from '../types';

export async function getAnswerFromBackend(
  jobId: string,
  question: string,
  logError: (error: Omit<LogError, 'timestamp'>) => void
): Promise<string> {
  try {
    const response = await fetch(`/api/jobs/${jobId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Falha ao obter resposta do backend.');
    }
    const { answer } = await response.json();
    return answer;
  } catch (error) {
    logError({ source: 'ChatService', message: error.message, severity: 'critical', details: error });
    throw error;
  }
}