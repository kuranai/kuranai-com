import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const varsPath = resolve(process.cwd(), '.dev.vars');
const hadVarsFile = existsSync(varsPath);
const originalVars = hadVarsFile ? readFileSync(varsPath, 'utf8') : undefined;
const e2ePassword = 'dovari-e2e-password-2026';
const localVars = `DOVARI_PASSWORD=${e2ePassword}\n`;

writeFileSync(varsPath, localVars);
const persistPath = mkdtempSync(resolve(tmpdir(), 'dovari-e2e-'));
const previousPersistPath = process.env.DOVARI_E2E_PERSIST_PATH;
process.env.DOVARI_E2E_PERSIST_PATH = persistPath;

let cleanedUp = false;
function restoreVarsFile() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  if (originalVars === undefined) {
    unlinkSync(varsPath);
  } else {
    writeFileSync(varsPath, originalVars);
  }
}

function run(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: 'inherit',
    });

    const forwardSignal = (signal) => {
      child.kill(signal);
    };

    process.on('SIGINT', forwardSignal);
    process.on('SIGTERM', forwardSignal);

    child.on('error', (error) => {
      console.error(error);
      resolveResult(1);
    });
    child.on('exit', (code) => {
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
      resolveResult(code ?? 1);
    });
  });
}

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('npm_execpath is required to run the browser tests.');
  }

  const migrationCode = await run(process.execPath, [
    npmCli,
    'run',
    'db:migrate:local',
    '--',
    '--persist-to',
    persistPath,
  ]);
  const buildCode = migrationCode === 0 ? await run(process.execPath, [npmCli, 'run', 'build']) : 1;
  const testCode =
    buildCode === 0
      ? await run(process.execPath, [
          npmCli,
          'exec',
          '--',
          'playwright',
          'test',
          '--config',
          'playwright.config.ts',
          ...process.argv.slice(2),
        ])
      : 1;
  process.exitCode = testCode;
} finally {
  restoreVarsFile();
  if (previousPersistPath === undefined) {
    delete process.env.DOVARI_E2E_PERSIST_PATH;
  } else {
    process.env.DOVARI_E2E_PERSIST_PATH = previousPersistPath;
  }
  rmSync(persistPath, { force: true, recursive: true });
}
