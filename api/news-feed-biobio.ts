import { proxyGet } from '../server/proxy';

export default {
  fetch(request: Request): Promise<Response> {
    return proxyGet(request, 'https://feeds.feedburner.com/radiobiobio/NNeJ', {
      accept: 'application/rss+xml, application/xml, text/xml',
    });
  },
};
