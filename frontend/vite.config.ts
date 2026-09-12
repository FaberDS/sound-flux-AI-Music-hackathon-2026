import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: env.API_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/engine': {
          target: env.AUDIO_ENGINE_TARGET || 'http://127.0.0.1:7860',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/engine/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (request) =>
              request.setHeader(
                'origin',
                env.AUDIO_ENGINE_TARGET || 'http://127.0.0.1:7860',
              ),
            )
          },
        },
      },
    },
  }
})
