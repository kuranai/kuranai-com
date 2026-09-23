import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  out: './migrations',
  schema: './src/worker/db/schema.ts',
  strict: true,
  verbose: true,
});
