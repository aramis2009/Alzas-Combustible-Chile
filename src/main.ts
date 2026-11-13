import './style.css';

type FuelId = '93' | '95' | '97' | 'diesel';
type Fuel = { id: FuelId; name: string };
type PeriodId = '1m' | '3m' | '6m' | '1y';
type Observation = { date: Date; prices: Record<FuelId, number | null> };
type NewsItem = { title: string; href: string; source: string; publishedAt: Date; summary: string; image?: string };

const fuels: Fuel[] = [
  { id: '93', name: 'Gasolina 93' },
  { id: '95', name: 'Gasolina 95' },
  { id: '97', name: 'Gasolina 97' },
  { id: 'diesel', name: 'Diésel' },
];
const periods: { id: PeriodId; label: string; months: number }[] = [
  { id: '1m', label: '1 mes', months: 1 },
  { id: '3m', label: '3 meses', months: 3 },
  { id: '6m', label: '6 meses', months: 6 },
  { id: '1y', label: '1 año', months: 12 },
];
const fuelColors: Record<FuelId, string> = { '93': '#f09a65', '95': '#78c7b7', '97': '#e5b45e', diesel: '#89b7df' };
const newsTerms = /combust|bencina|gasolin|di[eé]sel|petr[oó]leo|enap|mepco|crudo|brent|parafina|camioner|opec/i;
const refreshIntervalMs = 5 * 60 * 1000;
let selectedFuel: FuelId = '93';
let selectedPeriod: PeriodId = '3m';
let historyData: Observation[] = [];
let renderedObservations: Observation[] = [];
let historySnapshot = '';
let newsSnapshot = '';
let refreshInProgress = false;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root was not found');

app.innerHTML = `
  <main>
    <section class="chart-section" aria-labelledby="chart-title">
      <div class="chart-heading"><div><div class="eyebrow"><span class="pulse"></span> PRECIOS DE COMBUSTIBLES EN CHILE</div><h1 id="chart-title">El precio por litro,<br class="desktop-break"> semana a semana.</h1><p>Consulta la evolución reciente de los combustibles.</p></div><span class="latest-update" id="last-updated">Buscando último dato…</span></div>
      <div class="chart-toolbar"><div class="fuel-select" role="group" aria-label="Combustible">${fuels.map((fuel) => `<button type="button" data-fuel="${fuel.id}" aria-pressed="${fuel.id === selectedFuel}">${fuel.name}</button>`).join('')}</div><div class="period-select" role="group" aria-label="Período">${periods.map((period) => `<button type="button" data-period="${period.id}" aria-pressed="${period.id === selectedPeriod}">${period.label}</button>`).join('')}</div></div>
      <div class="chart-card"><div class="chart-meta"><div><span class="chart-fuel" id="chart-fuel">Gasolina 93</span><span class="chart-unit">Precio promedio reportado · pesos por litro</span></div><div class="chart-reading"><span class="date-range" id="date-range"></span><span class="chart-current"><span>Último valor observado</span><strong id="chart-last-price">—</strong></span></div></div><div class="chart-canvas" id="chart-canvas" aria-live="polite"><div class="chart-loading"><span class="spinner"></span><span>Cargando datos históricos…</span></div></div><div class="chart-tooltip" id="chart-tooltip" aria-hidden="true"></div><div class="chart-footer"><span>Fuente histórica: <a href="https://bencinaschile.cl/historial-precio-bencina/" target="_blank" rel="noreferrer">BencinasChile ↗</a></span><span>Datos de precios declarados a CNE · actualización diaria</span></div></div>
      <p class="source-method">Serie independiente construida con los precios que las estaciones informan a Bencina en Línea (CNE). Promedio de estaciones con precio vigente; cada estación fija su propio precio. <a href="https://bencinaschile.cl/fuentes-y-metodologia/" target="_blank" rel="noreferrer">Metodología ↗</a></p>
    </section>
    <section class="news-section" aria-labelledby="news-title"><div class="section-head"><div><div class="eyebrow">LO QUE PASA EN CHILE Y EL MERCADO</div><h2 id="news-title">Noticias relacionadas</h2></div><span class="news-updated" id="news-updated">Conectando con Cooperativa…</span></div><div class="news-list" id="news-list"><div class="news-state"><span class="spinner"></span><span>Cargando noticias recientes…</span></div></div></section>
  </main>
  <footer><span>Alzas Combustible Chile</span><span>Precios observados y noticias enlazadas a su fuente original.</span></footer>`;

const formatPrice = (value: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(value);
const dateFormatter = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' });

function monthBefore(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

function svgSafe(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

function parsePrice(value: string): number | null {
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) && parsed >= 200 && parsed <= 10000 ? parsed : null;
}

function parseHistory(html: string): { observations: Observation[]; latestDate: Date } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector<HTMLTableElement>('table.data-table');
  if (!table) throw new Error('The published historical price table was not found');
  const columns: Record<FuelId, number> = { '93': 1, '95': 2, '97': 3, diesel: 4 };
  const records = [...table.querySelectorAll('tbody tr')].flatMap((row): Observation[] => {
    const cells = [...row.querySelectorAll('th, td')];
    const match = (cells[0]?.textContent ?? '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return [];
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    const prices = Object.fromEntries(fuels.map((fuel) => [fuel.id, parsePrice(cells[columns[fuel.id]]?.textContent ?? '')])) as Record<FuelId, number | null>;
    if (!fuels.some((fuel) => prices[fuel.id] !== null)) return [];
    return [{ date, prices }];
  }).sort((left, right) => left.date.getTime() - right.date.getTime());
  const latest = records.at(-1);
  if (!latest) throw new Error('No historical observations were found in the published table');
  return { observations: records, latestDate: latest.date };
}

function renderEmpty(message: string, detail: string): void {
  const canvas = document.querySelector<HTMLDivElement>('#chart-canvas');
  if (!canvas) return;
  canvas.innerHTML = `<div class="chart-empty"><span class="empty-icon">↗</span><strong>${svgSafe(message)}</strong><p>${svgSafe(detail)}</p></div>`;
}

function renderChart(): void {
  const canvas = document.querySelector<HTMLDivElement>('#chart-canvas');
  const title = document.querySelector<HTMLElement>('#chart-fuel');
  const rangeLabel = document.querySelector<HTMLElement>('#date-range');
  const lastPriceLabel = document.querySelector<HTMLElement>('#chart-last-price');
  if (!canvas || !title || !rangeLabel || !lastPriceLabel) return;
  const latest = historyData.at(-1)?.date;
  if (!latest || historyData.length === 0) return;

  const period = periods.find((item) => item.id === selectedPeriod);
  if (!period) return;
  const requestedStart = monthBefore(latest, period.months);
  const selected = historyData.filter((entry) => entry.date >= requestedStart && entry.date <= latest && entry.prices[selectedFuel] !== null);
  title.textContent = fuels.find((fuel) => fuel.id === selectedFuel)?.name ?? '';
  if (selected.length === 0) {
    rangeLabel.textContent = `${dateFormatter.format(requestedStart)} — ${dateFormatter.format(latest)}`;
    lastPriceLabel.textContent = '—';
    renderEmpty('No hay observaciones para este período', 'El proveedor no publicó datos para las fechas seleccionadas.');
    return;
  }

  const start = selected[0]?.date ?? requestedStart;
  rangeLabel.textContent = `${dateFormatter.format(start)} — ${dateFormatter.format(latest)}`;
  renderedObservations = selected;
  const latestPrice = selected.at(-1)?.prices[selectedFuel];
  lastPriceLabel.textContent = latestPrice === null || latestPrice === undefined ? '—' : `$${formatPrice(latestPrice)} /L`;
  const left = 82;
  const right = 1014;
  const top = 24;
  const bottom = 334;
  const minValue = Math.min(...selected.map((entry) => entry.prices[selectedFuel] as number));
  const maxValue = Math.max(...selected.map((entry) => entry.prices[selectedFuel] as number));
  const padding = Math.max(12, (maxValue - minValue) * 0.09);
  const lower = Math.floor((minValue - padding) / 50) * 50;
  const upper = Math.ceil((maxValue + padding) / 50) * 50;
  const valueRange = Math.max(1, upper - lower);
  const timeRange = Math.max(1, latest.getTime() - start.getTime());
  const x = (date: Date): number => left + ((date.getTime() - start.getTime()) / timeRange) * (right - left);
  const y = (value: number): number => bottom - ((value - lower) / valueRange) * (bottom - top);
  const coords = selected.map((entry) => ({ entry, x: x(entry.date), y: y(entry.prices[selectedFuel] as number) }));
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const area = `${line} L${coords.at(-1)!.x.toFixed(2)},${bottom} L${coords[0]!.x.toFixed(2)},${bottom} Z`;
  const yTicks = Array.from({ length: 5 }, (_, index) => lower + (valueRange * index) / 4);
  const xTicks = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start.getTime() + (timeRange * index) / 4);
    return { date, x: x(date), label: new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', timeZone: 'America/Santiago' }).format(date) };
  });
  const color = fuelColors[selectedFuel];
  const dots = coords.map(({ entry, x: dotX, y: dotY }, index) => {
    const price = entry.prices[selectedFuel] as number;
    return `<circle class="chart-point" cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="${selected.length < 45 ? 3.4 : 2.8}" tabindex="0" role="button" data-index="${index}" aria-label="${dateFormatter.format(entry.date)}: $${formatPrice(price)} por litro"><title>${dateFormatter.format(entry.date)} · $${formatPrice(price)}/L</title></circle>`;
  }).join('');
  const lastPoint = coords.at(-1);
  if (!lastPoint) return;
  canvas.innerHTML = `<svg class="chart-svg" viewBox="0 0 1080 380" style="--series:${color}" role="group" aria-label="${svgSafe(fuels.find((fuel) => fuel.id === selectedFuel)?.name ?? '')}: serie de precios por litro entre ${dateFormatter.format(start)} y ${dateFormatter.format(latest)}"><text class="axis-title" x="20" y="15">CLP/L</text>${yTicks.map((tick) => `<line class="gridline" x1="${left}" y1="${y(tick).toFixed(2)}" x2="${right}" y2="${y(tick).toFixed(2)}"/><text class="axis-label" x="${left - 12}" y="${(y(tick) + 4).toFixed(2)}" text-anchor="end">$${formatPrice(tick)}</text>`).join('')}${xTicks.map((tick) => `<line class="tickline" x1="${tick.x.toFixed(2)}" y1="${bottom}" x2="${tick.x.toFixed(2)}" y2="${bottom + 6}"/><text class="date-tick" x="${tick.x.toFixed(2)}" y="${bottom + 24}" text-anchor="middle">${tick.label}</text>`).join('')}<path class="chart-area" d="${area}" style="fill:${color}"/><path class="chart-line" d="${line}" style="stroke:${color}"/><circle class="chart-endpoint-ring" cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="8"/><circle class="chart-endpoint" cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="4"/>${dots}</svg>`;
  const tooltip = document.querySelector<HTMLDivElement>('#chart-tooltip');
  const points = canvas.querySelectorAll<SVGCircleElement>('.chart-point');
  points.forEach((point) => {
    const show = (): void => {
      if (!tooltip) return;
      const index = Number(point.dataset.index);
      const observation = renderedObservations[index];
      const price = observation?.prices[selectedFuel];
      if (!observation || price === null || price === undefined) return;
      tooltip.innerHTML = `<strong>${dateFormatter.format(observation.date)}</strong><span>$${formatPrice(price)} <small>por litro</small></span>`;
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');
      const pointRect = point.getBoundingClientRect();
      const cardRect = canvas.closest<HTMLDivElement>('.chart-card')?.getBoundingClientRect();
      if (!cardRect) return;
      const proposedLeft = pointRect.left + pointRect.width / 2 - cardRect.left;
      tooltip.style.left = `${Math.min(Math.max(proposedLeft, 90), cardRect.width - 90)}px`;
      tooltip.style.top = `${Math.max(10, pointRect.top - cardRect.top - 67)}px`;
      point.classList.add('active');
    };
    const hide = (): void => {
      tooltip?.classList.remove('visible');
      tooltip?.setAttribute('aria-hidden', 'true');
      point.classList.remove('active');
    };
    point.addEventListener('pointerenter', show);
    point.addEventListener('pointermove', show);
    point.addEventListener('pointerleave', hide);
    point.addEventListener('focus', show);
    point.addEventListener('blur', hide);
  });
}

function plainText(markup: string): string {
  const decoded = new DOMParser().parseFromString(markup, 'text/html').documentElement.textContent ?? '';
  return new DOMParser().parseFromString(decoded, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function itemImage(item: Element): string | undefined {
  const media = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'content').item(0);
  const url = media?.getAttribute('url');
  if (!url) return undefined;
  try { return new URL(url).protocol === 'https:' ? url : undefined; } catch { return undefined; }
}

function summarize(text: string): string {
  const clean = text.trim();
  const words = clean.split(/\s+/);
  if (clean.length <= 185 && words.length <= 30) return clean;
  const excerpt = words.slice(0, 26).join(' ');
  return `${excerpt.replace(/[\s,;:]+$/, '')}…`;
}

function renderNews(items: NewsItem[]): void {
  const list = document.querySelector<HTMLDivElement>('#news-list');
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = '<div class="news-empty">No encontramos noticias recientes sobre combustibles en el feed disponible.</div>';
    return;
  }
  list.innerHTML = items.map((item) => `<article class="news-item${item.image ? '' : ' news-item-no-image'}"><a class="news-image-link" href="${svgSafe(item.href)}" target="_blank" rel="noreferrer">${item.image ? `<img class="news-image" src="${svgSafe(item.image)}" alt="" loading="lazy">` : '<span class="news-image news-image-empty" aria-hidden="true">AC</span>'}</a><div class="news-copy"><div class="news-meta"><span>${svgSafe(item.source)}</span><time datetime="${item.publishedAt.toISOString()}">${dateFormatter.format(item.publishedAt)}</time></div><h3><a href="${svgSafe(item.href)}" target="_blank" rel="noreferrer">${svgSafe(item.title)}</a></h3><p>${svgSafe(item.summary)}</p><a class="read-link" href="${svgSafe(item.href)}" target="_blank" rel="noreferrer">Leer noticia original <span>↗</span></a></div></article>`).join('');
}

async function loadHistory(): Promise<void> {
  const updated = document.querySelector<HTMLElement>('#last-updated');
  try {
    const response = await fetch('/api/fuel-history', { headers: { Accept: 'text/html' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Historical source responded with ${response.status}`);
    const result = parseHistory(await response.text());
    const snapshot = JSON.stringify(result.observations.map(({ date, prices }) => [date.getTime(), prices]));
    if (updated) updated.innerHTML = `Actualiza cada 5 min · último dato <b>${dateFormatter.format(result.latestDate)}</b>`;
    if (snapshot === historySnapshot) return;
    historySnapshot = snapshot;
    historyData = result.observations;
    renderChart();
  } catch {
    historySnapshot = '';
    renderEmpty('No pudimos cargar la serie histórica', 'La fuente de precios no respondió. Intenta recargar o consulta la metodología de origen.');
    if (updated) updated.textContent = 'Historial temporalmente no disponible';
  }
}

async function loadNews(): Promise<void> {
  const list = document.querySelector<HTMLDivElement>('#news-list');
  const updated = document.querySelector<HTMLElement>('#news-updated');
  try {
    const response = await fetch('/api/news-feed', { headers: { Accept: 'application/rss+xml, application/xml, text/xml' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`News feed responded with ${response.status}`);
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('News feed XML could not be parsed');
    const items = [...xml.querySelectorAll('channel > item')].flatMap((item): NewsItem[] => {
      const title = item.querySelector('title')?.textContent?.trim() ?? '';
      const href = item.querySelector('link')?.textContent?.trim() ?? '';
      const publishedAt = new Date(item.querySelector('pubDate')?.textContent?.trim() ?? '');
      const description = plainText(item.querySelector('description')?.textContent ?? item.querySelector('descent')?.textContent ?? '');
      if (!title || !newsTerms.test(`${title} ${description}`) || Number.isNaN(publishedAt.getTime())) return [];
      try { if (new URL(href).hostname !== 'www.cooperativa.cl') return []; } catch { return []; }
      return [{ title, href, source: 'Cooperativa', publishedAt, summary: summarize(description), image: itemImage(item) }];
    }).sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime()).slice(0, 12);
    const snapshot = JSON.stringify(items.map((item) => [item.title, item.href, item.publishedAt.getTime(), item.summary, item.image]));
    if (snapshot !== newsSnapshot) {
      newsSnapshot = snapshot;
      renderNews(items);
    }
    if (updated) updated.textContent = `Revisado · ${new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }).format(new Date())}`;
  } catch {
    newsSnapshot = '';
    if (list) list.innerHTML = '<div class="news-empty">No pudimos cargar las noticias. Vuelve a intentarlo más tarde.</div>';
    if (updated) updated.textContent = 'Noticias temporalmente no disponibles';
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-fuel]').forEach((button) => {
  button.addEventListener('click', () => {
    const id = button.dataset.fuel;
    if (id !== '93' && id !== '95' && id !== '97' && id !== 'diesel') return;
    selectedFuel = id;
    document.querySelectorAll('[data-fuel]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderChart();
  });
});
document.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((button) => {
  button.addEventListener('click', () => {
    const id = button.dataset.period;
    if (id !== '1m' && id !== '3m' && id !== '6m' && id !== '1y') return;
    selectedPeriod = id;
    document.querySelectorAll('[data-period]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderChart();
  });
});

async function refreshSources(): Promise<void> {
  if (refreshInProgress || document.visibilityState === 'hidden') return;
  refreshInProgress = true;
  try {
    await Promise.all([loadHistory(), loadNews()]);
  } finally {
    refreshInProgress = false;
  }
}

void refreshSources();
window.setInterval(() => void refreshSources(), refreshIntervalMs);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshSources();
});
window.addEventListener('online', () => void refreshSources());
