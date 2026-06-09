import { build } from 'esbuild';
import { resolve } from 'path';

await build({
  entryPoints: [resolve(__dirname, '../_worker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: resolve(__dirname, '../dist/_worker.js'),
  external: [],
});

console.log('Worker built successfully!');