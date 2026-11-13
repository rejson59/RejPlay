import { defineConfig } from 'vite';

/**
 * Statyczny build na GitHub Pages (/RejPlay/). Dev i preview pod „/”.
 * Zero assetów: cała grafika to Canvas / SVG / CSS, cały dźwięk to WebAudio.
 */
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/RejPlay/' : '/',
  build: { target: 'es2022', assetsInlineLimit: 100000 },
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
}));
