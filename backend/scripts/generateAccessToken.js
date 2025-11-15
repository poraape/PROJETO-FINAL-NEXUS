#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const tokenService = require('../services/tokenService');

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.replace(/^--/, '');
            const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
            parsed[key] = value;
            if (value !== 'true') {
                i += 1;
            }
        }
    }
    return parsed;
}

(async () => {
    try {
        const { sub = 'demo-user', org = 'demo-org', scopes, expiresIn = '2h' } = parseArgs();
        const scopesList = scopes ? scopes.split(',').map(item => item.trim()).filter(Boolean) : undefined;
        const token = tokenService.signAccessToken({ sub, orgId: org, scopes: scopesList }, { expiresIn });
        console.log(token);
    } catch (error) {
        console.error('Falha ao gerar token:', error.message);
        process.exit(1);
    }
})();
