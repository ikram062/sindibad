import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Browser talks to /api on the same origin; Vite forwards it to Express.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:4001' },
  },
})
