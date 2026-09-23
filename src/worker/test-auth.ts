import { loginWithPassword } from './auth/password';
import type { WorkerBindings } from './types';

export const TEST_PASSWORD = 'dovari-test-password-2026';
export const TEST_WORKER_VERSION = 'dovari-test-version';

export function authenticatedTestBindings(bindings: CloudflareBindings) {
  return {
    ...bindings,
    CF_VERSION_METADATA: { id: TEST_WORKER_VERSION },
    DOVARI_PASSWORD: TEST_PASSWORD,
  } as unknown as WorkerBindings;
}

export async function createTestSession(bindings: WorkerBindings) {
  const result = await loginWithPassword(
    new Request('http://localhost/api/auth/login', {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    }),
    bindings,
    TEST_PASSWORD,
  );
  if (!result.ok) throw new Error(`Could not create test session: ${result.code}`);
  return `__Host-dovari_session=${result.token}`;
}
