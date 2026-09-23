import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const e2ePersistPath = process.env.DOVARI_E2E_PERSIST_PATH;

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      persistState: e2ePersistPath ? { path: e2ePersistPath } : true,
    }),
  ],
});
