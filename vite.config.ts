import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente baseadas no modo (development/production)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    // Define process.env globalmente para o navegador
    define: {
      'process.env': env
    },
    server: {
      host: true,
      allowedHosts: ['criadordesites.onrender.com', '.onrender.com', 'localhost']
    },
    preview: {
      allowedHosts: ['criadordesites.onrender.com', '.onrender.com', 'localhost'],
      port: 4173,
      host: true
    }
  }
})