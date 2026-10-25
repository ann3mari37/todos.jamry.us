import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Workers-only module; tests that need sockets stub it per test.
    alias: { 'cloudflare:sockets': fileURLToPath(new URL('./test/sockets-stub.ts', import.meta.url)) },
  },
});
