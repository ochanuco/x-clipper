import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv }
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  await run('pnpm', ['run', 'build']);
  const tsconfigPath = path.join(repoRoot, 'tests/e2e/tsconfig.json');
  await run(
    'pnpm',
    ['exec', 'playwright', 'test', '-c', 'tests/e2e/playwright.config.ts'],
    { PLAYWRIGHT_TSCONFIG: tsconfigPath }
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
