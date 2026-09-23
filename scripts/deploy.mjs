import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const wranglerEntrypoint = resolve(projectRoot, 'node_modules/wrangler/bin/wrangler.js');
const wranglerConfig = resolve(projectRoot, 'wrangler.jsonc');
const requestedArgs = process.argv.slice(2);
const dryRun = requestedArgs.includes('--dry-run');
const deployArgs = requestedArgs.filter((argument) => argument !== '--dry-run');

function configuredResourceName(key, fallback) {
  const configuredValue = process.env[key];
  if (configuredValue) {
    return configuredValue;
  }

  if (!existsSync(wranglerConfig)) {
    return fallback;
  }

  const config = readFileSync(wranglerConfig, 'utf8');
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\n]+)"`, 'u').exec(config);
  return match?.[1] ?? fallback;
}

const databaseName = configuredResourceName('database_name', 'dovari');
const bucketName = configuredResourceName('bucket_name', 'dovari-assets');

function commandForNpm(args) {
  const npmEntrypoint = process.env.npm_execpath;
  if (npmEntrypoint) {
    return { command: process.execPath, args: [npmEntrypoint, ...args] };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}.`);
  }

  return typeof result.stdout === 'string' ? result.stdout : '';
}

function runNpm(args) {
  const invocation = commandForNpm(args);
  run(invocation.command, invocation.args);
}

function runWrangler(args, capture = false) {
  if (!existsSync(wranglerEntrypoint)) {
    throw new Error('Wrangler is not installed. Run npm ci before deploying Dovari.');
  }

  return run(
    process.execPath,
    [wranglerEntrypoint, ...args],
    capture ? { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] } : undefined,
  );
}

function withKeepVars(args) {
  return args.includes('--keep-vars') ? args : [...args, '--keep-vars'];
}

function parseJson(output, description) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Could not parse Wrangler's ${description} response.`);
  }
}

function hasD1Database(databases) {
  return Array.isArray(databases) && databases.some((database) => database.name === databaseName);
}

function hasR2Bucket(output) {
  const escapedName = bucketName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\b${escapedName}\\b`, 'u').test(output);
}

function ensureCloudflareResources() {
  const databases = parseJson(runWrangler(['d1', 'list', '--json'], true), 'D1 list');
  if (!hasD1Database(databases)) {
    console.log(`Creating D1 database "${databaseName}"…`);
    runWrangler(['d1', 'create', databaseName, '--binding', 'DB', '--use-remote']);
  } else {
    console.log(`Using existing D1 database "${databaseName}".`);
  }

  const buckets = runWrangler(['r2', 'bucket', 'list'], true);
  if (!hasR2Bucket(buckets)) {
    console.log(`Creating R2 bucket "${bucketName}"…`);
    runWrangler(['r2', 'bucket', 'create', bucketName]);
  } else {
    console.log(`Using existing R2 bucket "${bucketName}".`);
  }
}

async function main() {
  if (requestedArgs.includes('--help') || requestedArgs.includes('-h')) {
    console.log(`Usage: npm run deploy [-- --dry-run] [Wrangler deploy options]

The normal flow builds Dovari, provisions or connects D1 and R2, applies remote migrations,
and deploys the migrated Worker. --dry-run only builds and validates the production artifact.`);
    return;
  }

  runNpm(['run', 'build']);

  if (dryRun) {
    runWrangler(withKeepVars(['deploy', '--dry-run', ...deployArgs]));
    return;
  }

  console.log('\nProvisioning or connecting Cloudflare resources before migrations…');
  ensureCloudflareResources();

  console.log('\nApplying D1 migrations to the remote DB binding…');
  runWrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);

  console.log('\nDeploying the migrated Worker and preserving dashboard variables…');
  runWrangler(withKeepVars(['deploy', ...deployArgs]));
}

main().catch((error) => {
  console.error(
    `\nDovari deploy failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
