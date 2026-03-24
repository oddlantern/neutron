import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: 'esm',
  target: 'node20',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
