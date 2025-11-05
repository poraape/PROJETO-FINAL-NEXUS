// config.ts

/**
 * A chave de API do Google Gemini foi movida para o backend por segurança.
 * O frontend não terá mais acesso direto a ela.
 * Todas as chamadas para a IA serão intermediadas pelo nosso novo BFF (Backend-for-Frontend).
 * @deprecated A chave de API não deve ser exposta no cliente.
 */
export const GEMINI_API_KEY = "MOVED_TO_BACKEND";
