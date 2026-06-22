import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            GOOGLE_CLIENT_ID: 'test-google-client',
            JWT_SECRET: 'test-jwt-secret',
            FRONTEND_URL: 'http://localhost:5173',
            CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
  },
});
