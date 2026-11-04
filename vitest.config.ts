import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    {
      name: 'externalize-node-sqlite',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'node:sqlite' || id === 'sqlite') {
          return { id, external: true };
        }
      },
    },
  ],
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    // macOS aliases /var and /tmp; fixtures must use the same canonical paths as evidence.
    env: {
      TMPDIR: realpathSync(tmpdir()),
      TMP: realpathSync(tmpdir()),
      TEMP: realpathSync(tmpdir()),
    },
    testTimeout: 10000,
  },
});
