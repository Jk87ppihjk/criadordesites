import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // ADICIONADA ESSA LINHA PARA FORÇAR CAMINHOS RELATIVOS NO BUILD
      base: './', 
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      preview: {
        host: true,
        allowedHosts: ['criadordesites.onrender.com'] 
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
