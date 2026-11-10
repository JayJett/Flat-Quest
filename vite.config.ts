import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// BASE_PATH is set by the GitHub Pages workflow ("/Flat-Quest/"); defaults to the domain root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Port 3000 matches Supabase's default Site URL for local development.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000 },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts?(x)'] },
})
