import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

// Bundle dependencies with the existing extension build, then stage VSIX-only
// metadata. The scoped pnpm workspace identity is not a valid VSIX name.
const root = resolve(import.meta.dirname, '..');
const source = join(root, 'apps/vscode-extension');
const stage = join(root, '.data/vsix-stage');
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await mkdir(join(root, 'dist'), { recursive: true });
const metadata = { ...manifest };
delete metadata.dependencies;
delete metadata.scripts;
await writeFile(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      ...metadata,
      name: 'developer-intelligence',
      files: ['dist/extension.cjs', 'dist/mcp-cli.cjs', 'media/intelligence.svg', 'README.md'],
      repository: {
        type: 'git',
        url: 'https://github.com/Coder909-byte/developer-intelligence.git',
      },
    },
    null,
    2,
  ) + '\n',
);
await mkdir(join(stage, 'dist'));
await cp(join(source, 'dist/extension.cjs'), join(stage, 'dist/extension.cjs'));
await cp(join(source, 'dist/mcp-cli.cjs'), join(stage, 'dist/mcp-cli.cjs'));
await cp(join(source, 'media'), join(stage, 'media'), { recursive: true });
await cp(join(source, 'README.md'), join(stage, 'README.md'));
const output = join(root, 'dist', `developer-intelligence-${manifest.version}.vsix`);
const child = spawn(
  'pnpm',
  ['dlx', '@vscode/vsce@4.1.0', 'package', '--no-dependencies', '--skip-license', '--out', output],
  { cwd: stage, stdio: 'inherit' },
);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
  if (code === 0) console.log(`VSIX: ${output}`);
});
