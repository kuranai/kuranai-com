interface PublicHtmlMetadata {
  allowIndexing: boolean;
  canonicalUrl: string;
  description: string;
  etag: string;
  title: string;
}

function escapeAttribute(value: string) {
  return value.replace(/[&"'<>]/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}

function matchesEtag(request: Request, etag: string) {
  const header = request.headers.get('If-None-Match');
  if (header === null) return false;
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//iu, ''))
    .some((value) => value === '*' || value === etag);
}

function staticAssetRequest(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete('Authorization');
  headers.delete('Cookie');
  return new Request(request, { headers });
}

function metadataMarkup(metadata: PublicHtmlMetadata) {
  const robots = metadata.allowIndexing ? 'index,follow' : 'noindex,nofollow';
  const title = `${metadata.title} · Dovari`;
  const description = metadata.description || 'A published Dovari knowledge-base page.';
  const encoded = (value: string) => escapeAttribute(value);
  return [
    `<meta name="description" content="${encoded(description)}">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${encoded(metadata.canonicalUrl)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${encoded(title)}">`,
    `<meta property="og:description" content="${encoded(description)}">`,
    `<meta property="og:url" content="${encoded(metadata.canonicalUrl)}">`,
  ].join('');
}

export async function servePublicHtml(
  request: Request,
  assets: Fetcher,
  metadata: PublicHtmlMetadata,
) {
  const etag = `"dovari-public-${metadata.etag}"`;
  const responseHeaders = new Headers();
  responseHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
  responseHeaders.set('ETag', etag);
  responseHeaders.set(
    'X-Robots-Tag',
    metadata.allowIndexing ? 'index, follow' : 'noindex, nofollow',
  );

  if (matchesEtag(request, etag)) {
    return new Response(null, { headers: responseHeaders, status: 304 });
  }

  const assetResponse = await assets.fetch(staticAssetRequest(request));
  const headers = new Headers(assetResponse.headers);
  responseHeaders.forEach((value, name) => headers.set(name, value));
  headers.delete('Content-Length');

  if (request.method === 'HEAD' || assetResponse.body === null) {
    return new Response(null, {
      headers,
      status: assetResponse.status,
      statusText: assetResponse.statusText,
    });
  }

  const rewritten = new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(`${metadata.title} · Dovari`);
      },
    })
    .on('head', {
      element(element) {
        element.append(metadataMarkup(metadata), { html: true });
      },
    })
    .transform(new Response(assetResponse.body, { headers: assetResponse.headers }));

  return new Response(rewritten.body, {
    headers,
    status: assetResponse.status,
    statusText: assetResponse.statusText,
  });
}

export function publicHtmlEtagPart(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
