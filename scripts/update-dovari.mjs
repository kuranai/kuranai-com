import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}.`);
  }
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (result.status !== 0) {
    throw new Error('Could not determine the current Git commit.');
  }

  return result.stdout.trim();
}

function main() {
  const before = gitHead();
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'sync:dovari']);
  const after = gitHead();

  if (before === after) {
    console.log('Dovari is already up to date; no deploy is needed.');
    return;
  }

  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ]);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'ci']);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy']);
  run('git', ['push', 'origin', 'HEAD:main']);
  console.log(`kuranai.com now runs Dovari commit ${after}.`);
}

try {
  main();
} catch (error) {
  console.error(
    `\nDovari update failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
