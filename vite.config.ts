import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base is set from BASE_PATH so the same build works on GitHub Pages
// (https://<user>.github.io/<repo>/) and on a custom domain or local preview.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
  build: { outDir: 'dist', sourcemap: true },
})
