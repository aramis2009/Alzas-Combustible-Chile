import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/fuel-history': {
        target: 'https://bencinaschile.cl',
        changeOrigin: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlzasCombustibleChile/1.0)' },
        rewrite: () => '/historial-precio-bencina/',
      },
      '/api/news-feed': {
        target: 'https://www.cooperativa.cl',
        changeOrigin: true,
        rewrite: () => '/noticias/site/tax/port/all/rss_3___1.xml',
      },
    },
  },
  preview: {
    proxy: {
      '/api/fuel-history': {
        target: 'https://bencinaschile.cl',
        changeOrigin: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlzasCombustibleChile/1.0)' },
        rewrite: () => '/historial-precio-bencina/',
      },
      '/api/news-feed': {
        target: 'https://www.cooperativa.cl',
        changeOrigin: true,
        rewrite: () => '/noticias/site/tax/port/all/rss_3___1.xml',
      },
    },
  },
});
