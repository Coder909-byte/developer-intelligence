import * as esbuild from 'esbuild';
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  sourcemap: true,
};
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('Extension build watcher ready. Launch the Extension Development Host with F5.');
} else await esbuild.build(options);
