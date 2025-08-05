// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),

    electron([
      {
        /* Main-Process */
        entry: 'electron/index.ts',
      },
      {
        /* Preload */
        entry: 'electron/preload.ts',
      },
    ]),

    renderer(),
  ],

  build: {
    outDir: 'dist-vite',
    emptyOutDir: true,
  },

  server: {
    port: 3000,
  },
});
