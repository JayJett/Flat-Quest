import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Port 3000 matches Supabase's default Site URL for local development.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000 },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts?(x)'] },
})
