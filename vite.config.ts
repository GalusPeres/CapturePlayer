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
        onstart({ startup }) {
          const port = process.env.CAPTUREPLAYER_DEBUG_PORT;
          return port && /^\d{4,5}$/.test(port)
            ? startup(['.', `--remote-debugging-port=${port}`])
            : startup();
        }
      },
      {
        /* Preload */
        entry: 'electron/preload.ts',
        // Only the main build owns the process. Two simultaneous startup()
        // calls can both kill the same Windows PID and terminate Vite.
        onstart({ reload }) { reload(); }
      }
    ]),

    renderer()
  ],

  build: {
    outDir: 'dist-vite',
    emptyOutDir: true
  },

  server: {
    port: 3000
  }
});
