import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/proposals': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/scan': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/balance': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/vote': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/register': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/card': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/upload': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/contract': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/verify-pin': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
