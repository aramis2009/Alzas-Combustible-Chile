type ProxyOptions = {
  accept: string;
  userAgent?: string;
};

const upstreamTimeoutMs = 15_000;
const cacheControl = 'public, s-maxage=300, stale-while-revalidate=300';

export async function proxyGet(request: Request, upstreamUrl: string, options: ProxyOptions): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const headers = new Headers({ Accept: options.accept });
    if (options.userAgent) headers.set('User-Agent', options.userAgent);
    const upstream = await fetch(upstreamUrl, {
      headers,
      signal: AbortSignal.timeout(upstreamTimeoutMs),
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return new Response('Data source is temporarily unavailable', {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': cacheControl,
      },
    });
  } catch {
    return new Response('Data source is temporarily unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
