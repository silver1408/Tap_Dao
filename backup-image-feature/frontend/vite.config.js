import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/proposals': {
        target: 'http://localhost:9201',
        changeOrigin: true,
      },
      '/scan': {
        target: 'http://localhost:9201',
        changeOrigin: true,
      },
      '/balance': {
        target: 'http://localhost:9201',
        changeOrigin: true,
      },
      '/vote': {
        target: 'http://localhost:9201',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:9201',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
