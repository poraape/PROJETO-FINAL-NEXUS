// config.ts

/**
 * Retrieves the Gemini API key from localStorage.
 * Falls back to process.env for environments where it might be injected.
 * @returns The API key string, or null if not found.
 */
export const getApiKey = (): string | null => {
  // Primary method: get from localStorage
  const key = localStorage.getItem("GEMINI_API_KEY");
  if (key && key.trim() !== '') {
    return key;
  }
  
  // Fallback for injected environments (less common in this setup but good practice)
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    // @ts-ignore
    return process.env.API_KEY;
  }

  return null;
};

/**
 * Saves the Gemini API key to localStorage.
 * @param key The API key to save.
 */
export const setApiKey = (key: string): void => {
  if (key && key.trim() !== '') {
    localStorage.setItem("GEMINI_API_KEY", key);
  } else {
    localStorage.removeItem("GEMINI_API_KEY");
  }
};
