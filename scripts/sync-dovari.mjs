import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectRoot = resolve(process.cwd());
const upstreamRemote = process.env.DOVARI_UPSTREAM_REMOTE ?? 'upstream';
const upstreamUrl = process.env.DOVARI_UPSTREAM_URL ?? 'https://github.com/kuranai/dovari.git';
const upstreamBranch = process.env.DOVARI_UPSTREAM_BRANCH ?? 'main';
const upstreamRef = `${upstreamRemote}/${upstreamBranch}`;
const requestedArgs = new Set(process.argv.slice(2));
const dryRun = requestedArgs.has('--dry-run');
const pushAfterSync = requestedArgs.has('--push');

// These files describe this concrete installation rather than Dovari itself. They are restored
// after every upstream merge so a source update cannot point the deployment at dovari.dev or at a
// different D1/R2 instance.
const preservedFiles = [
  'AGENTS.md',
  'IMPLEMENTATION.md',
  'README.md',
  'scripts/install-smoke.mjs',
  'scripts/sync-dovari.mjs',
  'wrangler.jsonc',
  '.github/workflows/sync-dovari.yml',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const details = result.stderr?.trim() ? `\n${result.stderr.trim()}` : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status ?? 1}.${details}`,
    );
  }

  return result;
}

function git(args, options = {}) {
  return run('git', args, options);
}

function gitOutput(args, options = {}) {
  return git(args, { ...options, capture: true }).stdout.trim();
}

function assertCleanWorkingTree() {
  const status = gitOutput(['status', '--porcelain']);
  if (status) {
    throw new Error(
      'The working tree is not clean. Commit or stash local changes before synchronizing Dovari.',
    );
  }
}

function assertOnBranch() {
  const branch = gitOutput(['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
  if (!branch) {
    throw new Error('The Dovari sync requires a named branch; detached HEAD is not supported.');
  }
  return branch;
}

function ensureUpstreamRemote() {
  const remoteResult = git(['remote', 'get-url', upstreamRemote], { allowFailure: true });
  if (remoteResult.status !== 0) {
    git(['remote', 'add', upstreamRemote, upstreamUrl]);
    console.log(`Added ${upstreamRemote} remote: ${upstreamUrl}`);
    return;
  }

  const configuredUrl = remoteResult.stdout.trim();
  const normalizedConfigured = configuredUrl.replace(/\.git$/u, '').replace(/\/$/u, '');
  const normalizedExpected = upstreamUrl.replace(/\.git$/u, '').replace(/\/$/u, '');
  if (normalizedConfigured !== normalizedExpected) {
    throw new Error(
      `Remote ${upstreamRemote} already points to ${configuredUrl}, expected ${upstreamUrl}.`,
    );
  }
}

function savePreservedFiles() {
  return new Map(
    preservedFiles
      .filter((relativePath) => existsSync(join(projectRoot, relativePath)))
      .map((relativePath) => [relativePath, readFileSync(join(projectRoot, relativePath))]),
  );
}

function restorePreservedFiles(savedFiles) {
  for (const [relativePath, contents] of savedFiles) {
    writeFileSync(join(projectRoot, relativePath), contents);
    git(['add', '--', relativePath]);
  }
}

function resolveMergeConflicts(savedFiles) {
  const conflicts = gitOutput(['diff', '--name-only', '--diff-filter=U'])
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);

  for (const relativePath of conflicts) {
    if (savedFiles.has(relativePath)) {
      writeFileSync(join(projectRoot, relativePath), savedFiles.get(relativePath));
    } else {
      const checkout = git(['checkout', '--theirs', '--', relativePath], { allowFailure: true });
      if (checkout.status !== 0) {
        git(['rm', '--force', '--', relativePath]);
      }
    }
    git(['add', '--', relativePath]);
  }

  const remainingConflicts = gitOutput(['diff', '--name-only', '--diff-filter=U']);
  if (remainingConflicts) {
    throw new Error(`Could not resolve merge conflicts:\n${remainingConflicts}`);
  }
}

function patchLocalPackageMetadata() {
  const packagePath = join(projectRoot, 'package.json');
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.name = 'kuranai-com';
    packageJson.scripts ??= {};
    packageJson.scripts['sync:dovari'] = 'node scripts/sync-dovari.mjs';
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    git(['add', '--', 'package.json']);
  }

  const lockPath = join(projectRoot, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lockfile = JSON.parse(readFileSync(lockPath, 'utf8'));
    lockfile.name = 'kuranai-com';
    if (lockfile.packages?.['']) {
      lockfile.packages[''].name = 'kuranai-com';
    }
    writeFileSync(lockPath, `${JSON.stringify(lockfile, null, 2)}\n`);
    git(['add', '--', 'package-lock.json']);
  }
}

function hasMergeBase() {
  return git(['merge-base', 'HEAD', upstreamRef], { allowFailure: true }).status === 0;
}

function isUpstreamAlreadyIncluded() {
  return (
    git(['merge-base', '--is-ancestor', upstreamRef, 'HEAD'], { allowFailure: true }).status === 0
  );
}

function showPendingUpstreamChanges() {
  const summary = gitOutput(['diff', '--stat', 'HEAD', upstreamRef]);
  console.log(summary || 'No tree differences from Dovari upstream.');
}

function commitMerge(upstreamCommit) {
  const shortCommit = upstreamCommit.slice(0, 12);
  git(['commit', '--no-edit', '-m', `Sync Dovari upstream to ${shortCommit}`]);
}

function writeGithubSummary(upstreamCommit, changed) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  writeFileSync(
    outputPath,
    `changed=${changed ? 'true' : 'false'}\nupstream_commit=${upstreamCommit}\n`,
    { flag: 'a' },
  );
}

function pushMain() {
  const branch = assertOnBranch();
  if (branch !== 'main') {
    throw new Error(`Refusing to push an automatic sync from branch ${branch}; run it on main.`);
  }
  git(['push', 'origin', 'HEAD:main']);
}

async function main() {
  const branch = assertOnBranch();
  assertCleanWorkingTree();
  ensureUpstreamRemote();

  console.log(`Fetching ${upstreamRemote}/${upstreamBranch}…`);
  git(['fetch', '--no-tags', upstreamRemote, upstreamBranch, '--prune']);

  const upstreamCommit = gitOutput(['rev-parse', upstreamRef]);
  if (isUpstreamAlreadyIncluded()) {
    console.log(
      `${upstreamRef} (${upstreamCommit.slice(0, 12)}) is already included in ${branch}.`,
    );
    writeGithubSummary(upstreamCommit, false);
    return;
  }

  console.log(`Upstream changes from ${upstreamRef} (${upstreamCommit.slice(0, 12)}):`);
  showPendingUpstreamChanges();

  if (dryRun) {
    writeGithubSummary(upstreamCommit, false);
    return;
  }

  const savedFiles = savePreservedFiles();
  const mergeArgs = ['merge', '--no-commit', '--no-ff'];
  if (!hasMergeBase()) {
    mergeArgs.push('--allow-unrelated-histories');
  }
  mergeArgs.push(upstreamRef);

  console.log(`Merging ${upstreamRef}…`);
  const mergeResult = git(mergeArgs, { allowFailure: true });
  if (mergeResult.status !== 0 && !gitOutput(['diff', '--name-only', '--diff-filter=U'])) {
    throw new Error('The upstream merge failed without producing resolvable merge conflicts.');
  }

  resolveMergeConflicts(savedFiles);
  restorePreservedFiles(savedFiles);
  patchLocalPackageMetadata();
  git(['add', '--all']);
  commitMerge(upstreamCommit);

  const changed = true;
  writeGithubSummary(upstreamCommit, changed);
  console.log(`Dovari synchronized to ${upstreamCommit}.`);

  if (pushAfterSync) {
    pushMain();
  }
}

main().catch((error) => {
  console.error(`\nDovari sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
