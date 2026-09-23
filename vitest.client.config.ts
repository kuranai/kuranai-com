import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    execArgv: ['--no-webstorage'],
    include: ['src/client/**/*.test.{ts,tsx}'],
    name: 'client',
    setupFiles: ['./test/client.setup.ts'],
  },
});
