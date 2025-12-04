import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Permite hosts externos no modo de desenvolvimento
    host: true,
    allowedHosts: ['criadordesites.onrender.com', '.onrender.com', 'localhost']
  },
  preview: {
    // Correção específica para o erro "Blocked request" no Render
    allowedHosts: ['criadordesites.onrender.com', '.onrender.com', 'localhost'],
    port: 4173,
    host: true
  }
})
