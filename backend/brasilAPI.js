// backend/services/brasilAPI.js

const BASE_URL = 'https://brasilapi.com.br/api';

/**
 * Fetches company data from BrasilAPI using a CNPJ.
 * @param {string} cnpj The CNPJ to validate (only numbers).
 * @returns {Promise<object>} The company data.
 */
async function getCnpjData(cnpj) {
    try {
        const response = await fetch(`${BASE_URL}/cnpj/v1/${cnpj}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`BrasilAPI error for CNPJ ${cnpj}: ${errorData.message}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[BrasilAPI] Failed to fetch CNPJ ${cnpj}:`, error);
        // Return a structured error so the caller can handle it
        return { error: true, message: error.message, cnpj };
    }
}

module.exports = { getCnpjData };