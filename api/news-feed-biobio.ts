import { proxyGet } from '../server/proxy';

export function GET(request: Request): Promise<Response> {
  return proxyGet(request, 'https://feeds.feedburner.com/radiobiobio/NNeJ', {
    accept: 'application/rss+xml, application/xml, text/xml',
  });
}
