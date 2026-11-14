import { proxyGet } from '../server/proxy';

export function GET(request: Request): Promise<Response> {
  return proxyGet(request, 'https://www.cooperativa.cl/noticias/site/tax/port/all/rss_3___1.xml', {
    accept: 'application/rss+xml, application/xml, text/xml',
  });
}
