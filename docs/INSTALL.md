# Install Dovari

This guide covers the simplest supported installation: deploy a new Dovari instance to your own
Cloudflare account with the **Deploy to Cloudflare** button in the repository README.

The deployment creates a copy of the source repository in your GitHub account. It does not change
the original `kuranai/dovari` project, so you can keep developing the source separately.

## What you need

- A Cloudflare account with access to Workers, D1, and R2.
- A GitHub account. The Deploy to Cloudflare button creates a repository in that account.
- A domain is optional. Cloudflare provides a `workers.dev` address first, and you can add a
  custom domain afterwards.
- A private Dovari owner password. Use a strong password in production; `password` is suitable
  only for a temporary test instance.

## One-click installation

1. Click **Deploy to Cloudflare** in the README.
2. Sign in to Cloudflare and select the account that should own the deployment.
3. Authorize Cloudflare's GitHub application when prompted.
4. Choose **+ Create New** for the repository and give this installation its own name, for
   example `kuranai-com`. This is a copy of Dovari, not a replacement for the source repository.
5. Set names for the resources. Names such as these are easy to recognize and must be unused in
   your Cloudflare account:

   - Worker: `kuranai-com`
   - D1 database: `kuranai-com`
   - R2 bucket: `kuranai-com-assets`

6. Set `DOVARI_PASSWORD` to your private owner password. It must be configured as a **Secret**,
   not as a plain-text variable. The repository includes `.dev.vars.example`, so the Deploy to
   Cloudflare form can discover this secret and ask for it.
7. Keep the detected commands unless you have a specific reason to change them:

   - Build command: `npm run build`
   - Deploy command: `npm run deploy`

8. Start the deployment and wait until the build and deploy steps are green. Open the generated
   `workers.dev` URL and sign in at `/app`.

## Add a custom domain

After the first deployment succeeds:

1. Open **Workers & Pages** in Cloudflare and select the new Worker.
2. Open **Settings → Domains & Routes**.
3. Add your hostname, for example `kuranai.com`.
4. If the domain is not already in the same Cloudflare account, add it to Cloudflare and update
   its nameservers at the registrar first.
5. If the hostname previously pointed to GitHub Pages or another host, remove only the obsolete
   A, AAAA, or CNAME records for that hostname before adding the Worker domain. Cloudflare will
   create the Worker record for you.

The source configuration intentionally has no hard-coded custom domain. This prevents a new
installation from trying to attach to the original author's zone.

## Verify the installation

Open these URLs after DNS has propagated:

- `https://your-hostname.example/api/health` should return a JSON response with `"status":"ok"`.
- `https://your-hostname.example/app` should show the private login page.

If you do not have a custom domain yet, use the generated `workers.dev` URL in both examples.

## Troubleshooting

### The build says `DOVARI_PASSWORD` is missing

Open the Worker in Cloudflare and go to **Settings → Variables and Secrets**. Under the production
environment, add a secret named exactly `DOVARI_PASSWORD`, enter the password, save it, and rerun
the failed deployment. Do not add the password to `wrangler.jsonc`, `vars`, GitHub, or a committed
`.dev.vars` file.

If the form does not show the password field, make sure the repository copy contains
`.dev.vars.example` and restart the deployment setup from the current source repository.

### A resource name is already taken

D1 database names and R2 bucket names are account-wide. Choose another unique name in the setup
form, such as `kuranai-com-2026` and `kuranai-com-assets-2026`.

### The custom domain does not resolve

Confirm that the domain is active in the same Cloudflare account, that the registrar uses the
Cloudflare nameservers, and that old GitHub Pages or hosting records were removed. DNS caches can
take time to expire after a change.

### I want to run Dovari locally

Use the source repository instead of the generated deployment copy:

```sh
git clone https://github.com/kuranai/dovari.git
cd dovari
npm ci
cp .dev.vars.example .dev.vars
```

Replace the placeholder in `.dev.vars`, then initialize the local database and start Vite:

```sh
npm run db:migrate:local
npm run dev
```

`.dev.vars` is ignored by Git. Keep it local and never commit a real password.

## Update and rotate the password

If Workers Builds is connected to the generated GitHub repository, pushing to its configured
branch deploys updates automatically. For a manual update from a checkout, run `npm run deploy`.

To rotate the owner password with Wrangler:

```sh
npx wrangler login
npx wrangler secret put DOVARI_PASSWORD
npm run deploy
```

Changing the password invalidates existing sessions, so every device will need to sign in again.
