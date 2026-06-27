import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['127.0.0.1', 'localhost', '.trycloudflare.com', '.aizao.ai'],
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
