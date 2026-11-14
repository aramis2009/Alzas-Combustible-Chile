import { proxyGet } from '../server/proxy';

export default {
  fetch(request: Request): Promise<Response> {
    return proxyGet(request, 'https://bencinaschile.cl/historial-precio-bencina/', {
      accept: 'text/html',
      userAgent: 'Mozilla/5.0 (compatible; AlzasCombustibleChile/1.0)',
    });
  },
};
