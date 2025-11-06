import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  const isCodespace = Boolean(process.env.CODESPACE_NAME);
  const forwardedDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
  const defaultPort = parseInt(process.env.PORT || '8000', 10);
  const codespaceHost = isCodespace
    ? `${process.env.CODESPACE_NAME}-${defaultPort}.${forwardedDomain}`
    : 'localhost';

  return {
    server: {
      port: defaultPort,
      host: '0.0.0.0',
      strictPort: true,
      origin: isCodespace ? `https://${codespaceHost}` : undefined,
      hmr: {
        host: codespaceHost,
        protocol: isCodespace ? 'wss' : 'ws',
        clientPort: isCodespace ? 443 : defaultPort,
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
        },
      },
    },
    preview: {
      port: defaultPort,
      host: '0.0.0.0',
      strictPort: true,
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
