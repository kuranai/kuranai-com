const targetUrl = process.argv[2] ?? process.env.DOVARI_SMOKE_URL;
const password = process.env.DOVARI_SMOKE_PASSWORD;

if (!targetUrl) {
  console.error('Usage: npm run release:smoke -- https://your-dovari-host.example');
  process.exitCode = 1;
} else {
  const baseUrl = new URL(targetUrl);
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/u, '');

  async function request(path, init = {}) {
    return fetch(new URL(path, baseUrl), {
      ...init,
      headers: init.headers ?? {},
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  }

  async function main() {
    const health = await request('/api/health');
    if (health.status !== 200) {
      throw new Error(`Public health check returned HTTP ${health.status}.`);
    }

    const healthBody = await health.json();
    if (healthBody.status !== 'ok') {
      throw new Error('Public health check did not return { status: "ok" }.');
    }

    const root = await request('/');
    if (root.status !== 302 || root.headers.get('location') !== '/app') {
      throw new Error('Public root did not redirect to /app.');
    }

    const privateApp = await request('/app');
    const privateAppIsProtected =
      privateApp.status === 503 ||
      (privateApp.status === 302 && privateApp.headers.get('location')?.startsWith('/login?next='));
    if (!privateAppIsProtected) {
      throw new Error(`Private app returned unexpected HTTP ${privateApp.status}.`);
    }
    const privateApi = await request('/api/private/pages');
    if (privateApi.status !== 401 && privateApi.status !== 503) {
      throw new Error(`Private API returned unexpected HTTP ${privateApi.status}.`);
    }

    console.log('Fail-closed check passed: private app and API reject unauthenticated requests.');

    if (!password) {
      console.log(
        'No DOVARI_SMOKE_PASSWORD supplied; authenticated private smoke was skipped after the fail-closed check.',
      );
      return;
    }

    const login = await request('/api/auth/login', {
      body: JSON.stringify({ password }),
      headers: { 'Content-Type': 'application/json', Origin: baseUrl.origin },
      method: 'POST',
    });
    if (login.status !== 200) {
      throw new Error(`Password login returned HTTP ${login.status}.`);
    }
    const cookie = login.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-dovari_session='));
    if (!cookie) throw new Error('Password login did not return a session cookie.');

    const privatePages = await request('/api/private/pages', {
      headers: { Cookie: cookie.split(';', 1)[0] },
    });
    if (privatePages.status !== 200) {
      throw new Error(`Authenticated private Pages smoke returned HTTP ${privatePages.status}.`);
    }

    const body = await privatePages.json();
    if (!Array.isArray(body.pages)) {
      throw new Error('Authenticated private Pages smoke returned an invalid response.');
    }

    console.log(
      `Authenticated private smoke passed: ${body.pages.length} page summaries returned.`,
    );
  }

  main().catch((error) => {
    console.error(
      `Release smoke failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
