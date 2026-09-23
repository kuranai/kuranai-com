export type RouteClassification =
  | { kind: 'auth'; area: 'app' | 'api' }
  | { kind: 'health' }
  | { kind: 'private'; area: 'app' | 'api' }
  | { kind: 'public'; area: 'page' | 'api' }
  | { kind: 'static' }
  | { kind: 'unknown' };

function isPathOrChild(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isStaticAssetPath(pathname: string) {
  return pathname.startsWith('/assets/') || /\/[^/]+\.[^/]+$/.test(pathname);
}

function decodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

export function isApiPath(pathname: string) {
  const decodedPathname = decodePathname(pathname);
  return (
    decodedPathname !== null && (decodedPathname === '/api' || decodedPathname.startsWith('/api/'))
  );
}

export function classifyPath(pathname: string): RouteClassification {
  const decodedPathname = decodePathname(pathname);
  if (decodedPathname === null) {
    return { kind: 'unknown' };
  }

  if (decodedPathname === '/api/health') {
    return { kind: 'health' };
  }

  if (decodedPathname === '/') {
    return { kind: 'public', area: 'page' };
  }

  if (decodedPathname === '/login') {
    return { kind: 'auth', area: 'app' };
  }

  if (isPathOrChild(decodedPathname, '/api/auth')) {
    return { kind: 'auth', area: 'api' };
  }

  if (isPathOrChild(decodedPathname, '/app')) {
    return { kind: 'private', area: 'app' };
  }

  if (isPathOrChild(decodedPathname, '/api/private')) {
    return { kind: 'private', area: 'api' };
  }

  if (isPathOrChild(decodedPathname, '/p')) {
    return { kind: 'public', area: 'page' };
  }

  if (isPathOrChild(decodedPathname, '/api/public')) {
    return { kind: 'public', area: 'api' };
  }

  if (isApiPath(decodedPathname)) {
    return { kind: 'unknown' };
  }

  if (isStaticAssetPath(decodedPathname)) {
    return { kind: 'static' };
  }

  return { kind: 'unknown' };
}
