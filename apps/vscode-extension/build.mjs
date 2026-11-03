import * as esbuild from 'esbuild';
const options = {
  entryPoints: [
    { in: 'src/extension.ts', out: 'extension' },
    { in: '../../packages/mcp-gateway/src/cli.ts', out: 'mcp-cli' },
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  external: ['vscode'],
  sourcemap: true,
};
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('Extension build watcher ready. Launch the Extension Development Host with F5.');
} else await esbuild.build(options);
