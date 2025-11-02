// config.ts

/**
 * Validates a key by making a test call to the Gemini API.
 * @param apiKey The key to validate.
 * @returns {Promise<boolean>} True if the key is valid.
 */
const validateKeyWithApi = async (apiKey: string): Promise<boolean> => {
    if (!apiKey) return false;
    const verifyUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const response = await fetch(verifyUrl);
        if (response.ok) {
            console.log("[API Key] Validação da chave bem-sucedida.");
            return true;
        }
        console.warn(`[API Key] A validação da chave falhou com o status: ${response.status}`);
        const errorData = await response.json().catch(() => null);
        console.warn("[API Key] Detalhes do erro:", errorData?.error?.message || 'Nenhum detalhe adicional.');
        return false;
    } catch (error) {
        console.error("[API Key] Erro de rede durante a validação da chave:", error);
        return false;
    }
};

/**
 * Retrieves the Gemini API key synchronously from localStorage.
 * This is used by the geminiService which expects a synchronous call.
 */
export const getApiKey = (): string | null => {
  const key = localStorage.getItem("GEMINI_API_KEY");
  return key && key.trim() !== '' ? key : null;
};

/**
 * Saves or removes the Gemini API key from localStorage.
 * @param key The API key to save, or an empty string to remove.
 */
export const setApiKey = (key: string): void => {
  if (key && key.trim() !== '') {
    localStorage.setItem("GEMINI_API_KEY", key.trim());
  } else {
    localStorage.removeItem("GEMINI_API_KEY");
  }
};


/**
 * Takes a key, validates it, and if valid, stores it in localStorage.
 * @param key The API key to validate and store.
 * @returns {Promise<boolean>} True if the key is valid and stored, false otherwise.
 */
export const validateAndStoreApiKey = async (key: string): Promise<boolean> => {
    const isValid = await validateKeyWithApi(key);
    if (isValid) {
        setApiKey(key);
    }
    return isValid;
};

/**
 * Checks if the currently stored API key is valid. If not, it removes it.
 * @returns {Promise<boolean>} True if a valid key is stored, false otherwise.
 */
export const verifyStoredApiKey = async (): Promise<boolean> => {
    const storedKey = getApiKey();
    if (!storedKey) {
        return false;
    }
    const isValid = await validateKeyWithApi(storedKey);
    if (!isValid) {
        setApiKey(''); 
    }
    return isValid;
};