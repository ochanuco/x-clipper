import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const packageJsonPath = path.join(projectRoot, 'package.json');
const manifestPath = path.join(projectRoot, 'public', 'manifest.base.json');

function bumpPatch(version) {
  const matched = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!matched) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  const major = Number(matched[1]);
  const minor = Number(matched[2]);
  const patch = Number(matched[3]) + 1;
  return `${major}.${minor}.${patch}`;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json version is missing.');
  }
  if (typeof manifest.version !== 'string') {
    throw new Error('manifest.base.json version is missing.');
  }
  if (packageJson.version !== manifest.version) {
    throw new Error(
      `Version mismatch: package.json=${packageJson.version}, manifest.base.json=${manifest.version}`
    );
  }

  const nextVersion = bumpPatch(packageJson.version);
  packageJson.version = nextVersion;
  manifest.version = nextVersion;

  if (!dryRun) {
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  console.log(nextVersion);
}

run().catch((error) => {
  console.error('Failed to bump version', error);
  process.exit(1);
});
