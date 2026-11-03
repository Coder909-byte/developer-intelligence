import { spawnSync } from 'node:child_process';
console.log(`Node ${process.version}; platform ${process.platform}`);
for (const command of ['pnpm', 'cargo', 'rustc', 'code', 'platformio', 'kicad-cli', 'iverilog']) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 });
  console.log(
    `${command}: ${result.error || result.status !== 0 ? 'unavailable (optional except pnpm)' : (result.stdout || result.stderr).trim().split('\n')[0]}`,
  );
}
