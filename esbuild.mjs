import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/background.ts', 'src/content-script.ts'],
    bundle: true,
    outdir: 'dist',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    logLevel: 'info',
});
