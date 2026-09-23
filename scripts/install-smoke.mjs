import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const MIN_NODE_MAJOR = 26;
const MIN_NPM_MAJOR = 11;
const sourceRoot = process.cwd();

function majorVersion(version) {
  const match = /^v?(\d+)/u.exec(version);
  return match ? Number(match[1]) : 0;
}

function assertRuntime() {
  const nodeMajor = majorVersion(process.versions.node);
  if (nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(
      `Dovari requires Node.js ${MIN_NODE_MAJOR}+ (found ${process.versions.node}). ` +
        'Use the documented Node.js LTS runtime before running the install smoke.',
    );
  }

  const npmVersion = process.env.npm_config_user_agent?.match(/npm\/(\d+)/u)?.[1];
  if (npmVersion && Number(npmVersion) < MIN_NPM_MAJOR) {
    throw new Error(
      `Dovari requires npm ${MIN_NPM_MAJOR}+ (found ${npmVersion}). ` +
        'Run the smoke with the npm version shipped with the supported Node.js runtime.',
    );
  }
}

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

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      CI: process.env.CI ?? '1',
      DOVARI_PASSWORD: 'dovari-install-smoke-password-2026',
    },
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}.`);
  }

  return result;
}

function runNpm(cwd, args) {
  const invocation = commandForNpm(args);
  return run(invocation.command, invocation.args, cwd);
}

function wranglerPath(cwd) {
  const entrypoint = resolve(cwd, 'node_modules/wrangler/bin/wrangler.js');
  if (!existsSync(entrypoint)) {
    throw new Error(`Wrangler was not installed in ${cwd}.`);
  }
  return entrypoint;
}

function runWrangler(cwd, args, capture = false) {
  const result = run(
    process.execPath,
    [wranglerPath(cwd), ...args],
    cwd,
    capture ? { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' } : undefined,
  );
  return capture ? result.stdout.trim() : '';
}

function parseWranglerJson(output, description) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Could not parse the Wrangler JSON response for ${description}.`);
  }
}

function executeJson(cwd, statement, description) {
  const output = runWrangler(
    cwd,
    [
      'd1',
      'execute',
      'DB',
      '--local',
      '--persist-to',
      join(cwd, '.install-state'),
      '--command',
      statement,
      '--json',
    ],
    true,
  );
  const response = parseWranglerJson(output, description);
  if (!Array.isArray(response) || response.some((result) => result.success !== true)) {
    throw new Error(`The Wrangler JSON response for ${description} reported a failure.`);
  }
  return response[0]?.results ?? [];
}

function copySourceToFreshCheckout(targetRoot) {
  cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter(source) {
      const relativePath = relative(sourceRoot, source);
      if (!relativePath) {
        return true;
      }

      const firstSegment = relativePath.split(/[\\/]/u)[0];
      if (
        firstSegment === '.git' ||
        firstSegment === 'node_modules' ||
        firstSegment === 'dist' ||
        firstSegment === '.wrangler' ||
        firstSegment === 'coverage' ||
        firstSegment === 'test-results' ||
        basename(source) === '.dev.vars' ||
        (basename(source).startsWith('.dev.vars.') && basename(source) !== '.dev.vars.example')
      ) {
        return false;
      }

      return true;
    },
  });
}

function migrationNames(cwd) {
  return readdirSync(join(cwd, 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function main() {
  assertRuntime();

  const tempRoot = mkdtempSync(join(tmpdir(), 'dovari-install-'));
  const freshRoot = join(tempRoot, 'checkout');
  try {
    console.log(`Creating a clean checkout at ${freshRoot}…`);
    copySourceToFreshCheckout(freshRoot);

    console.log('\nInstalling the lockfile in the clean checkout…');
    runNpm(freshRoot, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);

    const statePath = join(freshRoot, '.install-state');
    console.log('\nApplying every checked-in D1 migration to an isolated local database…');
    runWrangler(freshRoot, [
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--persist-to',
      statePath,
    ]);
    runWrangler(freshRoot, [
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--persist-to',
      statePath,
    ]);

    const appliedMigrations = executeJson(
      freshRoot,
      'SELECT name FROM d1_migrations ORDER BY id',
      'applied migrations',
    ).map((row) => row.name);
    const expectedMigrations = migrationNames(freshRoot);
    if (JSON.stringify(appliedMigrations) !== JSON.stringify(expectedMigrations)) {
      throw new Error(
        `Migration history mismatch. Expected ${expectedMigrations.join(', ')}, got ${appliedMigrations.join(', ')}.`,
      );
    }

    const foreignKeys = executeJson(freshRoot, 'PRAGMA foreign_key_check', 'foreign-key integrity');
    if (foreignKeys.length !== 0) {
      throw new Error('The fresh D1 database has foreign-key violations.');
    }

    executeJson(
      freshRoot,
      "INSERT INTO pages_fts(pages_fts) VALUES ('integrity-check')",
      'FTS5 integrity',
    );

    console.log('\nBuilding and validating the production artifact in the clean checkout…');
    runNpm(freshRoot, ['run', 'build']);
    runWrangler(freshRoot, ['deploy', '--dry-run', '--keep-vars']);
    console.log('\nFresh install smoke passed.');
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(
    `\nFresh install smoke failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
