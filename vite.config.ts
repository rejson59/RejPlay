import { defineConfig } from 'vite';

/**
 * Na GitHub Pages strona żyje pod /RejPlay/, więc wszystkie assety muszą mieć
 * ten prefiks. Lokalny dev oraz preview pozostają pod „/”. Vite wystawia
 * `import.meta.env.BASE_URL`, z którego korzystają moduły ładujące GLB,
 * tekstury i pliki MediaPipe.
 */
export default defineConfig(({ mode }) => ({
  // `vite preview` również działa w trybie production, więc sprawdza tę samą
  // ścieżkę bazową co wdrożenie na Pages. Dev (mode=development) zostaje pod /.
  base: mode === 'production' ? '/RejPlay/' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Dev/preview jest serwowany przez proxy Arena (*.e2b.app).
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
}));
