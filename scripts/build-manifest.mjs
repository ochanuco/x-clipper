import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const baseManifestPath = path.join(projectRoot, 'public', 'manifest.base.json');
const outputManifestPath = path.join(projectRoot, 'dist', 'manifest.json');

const DEV_HOST_PERMISSIONS = [
  'https://t.co/*',
  'https://x.com/*',
  'https://twitter.com/*',
  'https://*.twimg.com/*',
  'https://video.twimg.com/*',
  'https://api.notion.com/*',
  'http://localhost:8787/*',
  'http://127.0.0.1:8787/*'
];

const PROD_HOST_PERMISSIONS = [
  'https://t.co/*',
  'https://x.com/*',
  'https://twitter.com/*',
  'https://*.twimg.com/*',
  'https://video.twimg.com/*',
  'https://api.notion.com/*'
];

function getEnv() {
  const arg = process.argv.find((value) => value.startsWith('--env='));
  const env = arg ? arg.slice('--env='.length) : 'dev';
  if (env !== 'dev' && env !== 'prod') {
    throw new Error(`Unsupported env: ${env}. Use --env=dev or --env=prod.`);
  }
  return env;
}

async function run() {
  const env = getEnv();
  const raw = await readFile(baseManifestPath, 'utf8');
  const baseManifest = JSON.parse(raw);

  const host_permissions = env === 'prod' ? PROD_HOST_PERMISSIONS : DEV_HOST_PERMISSIONS;
  const manifest = { ...baseManifest, host_permissions };

  await writeFile(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

run().catch((error) => {
  console.error('Failed to build manifest', error);
  process.exit(1);
});
