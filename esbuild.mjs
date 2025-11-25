import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, 'dist');
const publicDir = path.resolve(__dirname, 'public');

async function build() {
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });

    await esbuild.build({
        entryPoints: ['src/background.ts', 'src/content-script.ts', 'src/options.ts'],
        bundle: true,
        outdir: 'dist',
        platform: 'browser',
        target: 'es2020',
        sourcemap: true,
        logLevel: 'info'
    });

    if (existsSync(publicDir)) {
        await cp(publicDir, distDir, { recursive: true });
    }
}

build().catch((error) => {
    console.error('Build failed', error);
    process.exit(1);
});
