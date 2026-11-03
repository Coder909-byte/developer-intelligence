import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';
export default defineConfig({
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
