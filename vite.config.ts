import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ isSsrBuild }) => ({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets this.
  // Dev, emulators and Firebase Hosting all stay at the root.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // so phones/tablets on the studio wifi can reach the dev server
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The firebase vendor chunk is legitimately ~500 kB; don't warn about it.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Firebase is most of the bundle and changes far less often than our
        // code — splitting it lets browsers keep it cached across deploys.
        // Skipped for the SSR smoke-test build, where deps stay external.
        manualChunks: isSsrBuild
          ? undefined
          : {
              firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
              react: ['react', 'react-dom', 'react-router-dom'],
            },
      },
    },
  },
}))
