import './style.css';
type Fuel = { id: string; name: string; price?: number; change?: number };

const fuels: Fuel[] = [
  { id: '93', name: 'Gasolina 93' },
  { id: '95', name: 'Gasolina 95' },
  { id: '97', name: 'Gasolina 97' },
  { id: 'diesel', name: 'Diésel' },
];
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root was not found');

app.innerHTML = `
  <header class="topbar"><a class="brand" href="#"><span class="brand-mark">AC</span><span>Alzas<span class="brand-light">Combustible Chile</span></span></a><a class="source-link" href="https://www.cne.cl/estadisticas/hidrocarburo/" target="_blank" rel="noreferrer">Fuentes de datos <span>↗</span></a></header>
  <main>
    <section class="intro"><div><div class="eyebrow"><span class="pulse"></span> MONITOR DE COMBUSTIBLES · CHILE</div><h1>El precio que mueve<br/>a todo un país.</h1><p>Precios, cambios y noticias para entender qué está pasando con los combustibles.</p></div><div class="intro-aside"><span class="aside-icon">↗</span><span>Datos oficiales<br/><b>CNE · ENAP</b></span></div></section>
    <section class="price-section"><div class="section-head"><div><div class="eyebrow">EN ESTE MOMENTO</div><h2>Precios de referencia</h2></div><span class="update-label" id="updated">Consultando fuente oficial…</span></div><div class="fuel-grid" id="fuel-grid">${fuels.map((f) => `<article class="fuel-card" data-fuel="${f.id}"><div class="fuel-top"><span>${f.name}</span><span class="fuel-dot"></span></div><div class="price">—<small>$/L</small></div><div class="change muted">Cargando precio reportado</div></article>`).join('')}</div><p class="disclaimer">Promedios nacionales de estaciones informantes. Los precios pueden variar por comuna y servicentro. <a href="https://www.bencinaenlinea.cl/" target="_blank" rel="noreferrer">Consulta el detalle en Bencina en Línea ↗</a></p></section>
    <section class="chart-section"><div class="section-head"><div><div class="eyebrow">TENDENCIA</div><h2>Evolución de precios</h2></div><div class="periods" role="group" aria-label="Período del gráfico"><button data-period="1m">1M</button><button class="selected" data-period="3m">3M</button><button data-period="6m">6M</button><button data-period="1y">1A</button></div></div><div class="chart-wrap"><div class="chart-legend" id="legend"></div><div class="chart" id="chart"><div class="chart-empty"><span>◷</span><b>Historial en preparación</b><p>La serie oficial de precios al consumidor de INE está descontinuada desde 2008. Para evitar mostrar cifras no verificadas, el gráfico se habilitará cuando se integre una serie vigente y trazable.</p><a href="https://energiaabierta.cne.cl/categorias-estadistica/hidrocarburos" target="_blank" rel="noreferrer">Explorar series públicas en Energía Abierta ↗</a></div></div><div class="chart-foot"><span>Fuente histórica: <a href="https://www.cne.cl/estadisticas/hidrocarburo/" target="_blank" rel="noreferrer">CNE · Estadísticas de hidrocarburos</a></span><span>Valores en pesos por litro</span></div></div></section>
    <section class="news-section"><div class="section-head"><div><div class="eyebrow">CONTEXTO Y ACTUALIDAD</div><h2>Lo que explica el precio</h2></div><span class="news-note">Fuentes oficiales · enlaces directos</span></div><div class="news-grid"><a class="news-card featured" href="https://www.enap.cl/informe-semanal-de-precios?page=1&year=2026" target="_blank" rel="noreferrer"><span class="news-type">PRECIOS · CHILE</span><span class="news-arrow">↗</span><h3>Informe semanal de precios estimados para combustibles</h3><p>ENAP publica estimaciones semanales y explica los factores que inciden en los valores de referencia.</p><span class="news-source">ENAP <span>· Sitio oficial</span></span></a><a class="news-card" href="https://www.cne.cl/estadisticas/hidrocarburo/" target="_blank" rel="noreferrer"><span class="news-type">DATOS · CHILE</span><span class="news-arrow">↗</span><h3>Estadísticas de hidrocarburos</h3><p>Series y recursos públicos de la Comisión Nacional de Energía sobre precios y mercado.</p><span class="news-source">Comisión Nacional de Energía <span>· Datos públicos</span></span></a><a class="news-card" href="https://energiaabierta.cne.cl/" target="_blank" rel="noreferrer"><span class="news-type">ENERGÍA · CHILE</span><span class="news-arrow">↗</span><h3>Energía Abierta</h3><p>Portal de datos abiertos para explorar indicadores del sector energético chileno.</p><span class="news-source">CNE <span>· Portal de datos</span></span></a></div><p class="news-caveat">Estos enlaces apuntan a publicaciones y portales oficiales; aún no son un agregador de noticias en tiempo real.</p></section>
  </main><footer><span>Alzas Combustible Chile</span><span>Datos claros para entender mejor. · <a href="https://www.cne.cl/estadisticas/hidrocarburo/">Fuentes</a></span></footer>`;

const formatPrice = (value: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(value);

// The CNE export is used as a live source; failures stay visible instead of being replaced by guessed prices.
async function loadCurrentPrices(): Promise<void> {
  const endpoints = [
    'https://api.bencinaenlinea.cl/api/estaciones/precios_combustibles/export_zonal',
    'https://api.cne.cl/v3/combustibles/vehicular/estaciones?token=',
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const payload: unknown = await response.json();
      const records = Array.isArray(payload) ? payload : [];
      const values = new Map<string, number[]>();
      for (const item of records) {
        if (typeof item !== 'object' || item === null) continue;
        const row = item as Record<string, unknown>;
        const type = String(row.tipo_combustible ?? row.combustible ?? row.tipo ?? '').toLowerCase();
        const price = Number(row.precio ?? row.precio_combustible ?? row.valor);
        const id = type.includes('93') ? '93' : type.includes('95') ? '95' : type.includes('97') ? '97' : /diesel|di[eé]sel|petroleo/.test(type) ? 'diesel' : '';
        if (!id || !Number.isFinite(price) || price <= 0) continue;
        values.set(id, [...(values.get(id) ?? []), price]);
      }
      if ([...values.values()].some((group) => group.length)) {
        for (const fuel of fuels) {
          const group = values.get(fuel.id);
          if (!group?.length) continue;
          fuel.price = Math.round(group.reduce((sum, price) => sum + price, 0) / group.length);
          const card = document.querySelector<HTMLElement>(`[data-fuel="${fuel.id}"]`);
          if (card) card.innerHTML = `<div class="fuel-top"><span>${fuel.name}</span><span class="fuel-dot"></span></div><div class="price">$${formatPrice(fuel.price)}<small>$/L</small></div><div class="change muted">Variación histórica no disponible</div>`;
        }
        const stamp = document.querySelector<HTMLElement>('#updated');
        if (stamp) stamp.textContent = `Consulta en vivo · ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`;
        return;
      }
    } catch { /* A later source may work even when the first endpoint is unreachable. */ }
  }
  const stamp = document.querySelector<HTMLElement>('#updated');
  if (stamp) stamp.innerHTML = 'Precios en vivo no disponibles <a href="https://www.bencinaenlinea.cl/" target="_blank" rel="noreferrer">Consultar CNE ↗</a>';
  document.querySelectorAll<HTMLElement>('.fuel-card .change').forEach((node) => { node.textContent = 'Fuente en vivo no disponible'; });
}

loadCurrentPrices();

document.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-period]').forEach((item) => item.classList.remove('selected'));
    button.classList.add('selected');
  });
});
