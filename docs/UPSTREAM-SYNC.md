# Upstream synchronization

This repository is the deployment instance for `kuranai.com`. The application source comes from
[`kuranai/dovari`](https://github.com/kuranai/dovari); the local repository keeps only the
installation-specific Cloudflare configuration and automation as an overlay.

## Automatic mode

`.github/workflows/sync-dovari.yml` checks `kuranai/dovari/main` every day and can also be started
manually under **Actions → Sync and deploy Dovari → Run workflow**. When a new upstream commit is
found, it:

1. merges the upstream source into this repository,
2. preserves the `kuranai.com` deployment configuration,
3. installs dependencies and runs `npm run ci`,
4. deploys the tested Worker, and
5. pushes the synchronized merge commit to `main`.

The workflow needs these repository secrets:

- `CLOUDFLARE_API_TOKEN`: an account-scoped token that can list/update Workers, D1, R2, and routes;
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID containing the existing resources.

The production `DOVARI_PASSWORD` remains a Cloudflare runtime secret. It is not copied into GitHub
or into the repository.

If either Cloudflare secret is missing, the workflow stops before pushing the synchronization
commit. This prevents an untested or undeployed source update from becoming the repository's
published state.

## Manual mode

The same synchronization can be run locally:

```sh
npm run sync:dovari
npm run ci
npm run deploy
```

With a local `npx wrangler login` session, the complete flow is also available as one command:

```sh
npm run update:dovari
```

It only deploys and pushes when a new upstream commit was merged. If tests or deployment fail, the
new merge remains local and is not pushed to `main`.

The sync script requires a clean working tree and creates a merge commit. It handles the existing
unrelated Git histories on the first run; later runs use ordinary upstream merges. Use
`npm run sync:dovari -- --dry-run` to inspect the upstream tree without changing files.

## Preserved installation files

The sync deliberately keeps these files from this repository:

- `wrangler.jsonc`, including the `kuranai.com` route, D1 database, R2 bucket, and Access values;
- `README.md`, `AGENTS.md`, and `IMPLEMENTATION.md`;
- the installation-specific `scripts/install-smoke.mjs`;
- the synchronization/update scripts and workflow.

Dependency and application changes from Dovari are still imported. The package name is normalized
back to `kuranai-com` after each sync so `package.json` and `package-lock.json` remain consistent.
