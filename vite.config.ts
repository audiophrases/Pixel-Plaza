import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The English dictionary's two files, which the package does not export on their own.
  resolve: { alias: {
    'english-dictionary': fileURLToPath(new URL('./node_modules/dictionary-en', import.meta.url)),
    'english-dictionary-gb': fileURLToPath(new URL('./node_modules/dictionary-en-gb', import.meta.url))
  } },
  // In development the Worker runs separately (npm run dev:worker); the
  // deployed app serves both from one origin.
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
})
