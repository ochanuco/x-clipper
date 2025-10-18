import { spawn } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const publicDir = path.join(projectRoot, 'public');

async function run() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['exec', 'tsc'], {
      stdio: 'inherit',
      cwd: projectRoot
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`tsc exited with code ${code}`));
      }
    });
  });

  if (existsSync(publicDir)) {
    await cp(publicDir, distDir, { recursive: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
