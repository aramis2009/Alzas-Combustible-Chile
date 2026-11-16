import './style.css';
import { FuelStationsMap, type FuelId } from './stations-map';

type Fuel = { id: FuelId; name: string };
type PeriodId = '1m' | '3m' | '6m' | '1y';
type Observation = { date: Date; prices: Record<FuelId, number | null> };
type NewsItem = { title: string; href: string; source: string; publishedAt: Date; summary: string; image?: string };
type NewsSource = { endpoint: string; name: string; host: string; format: 'rss' | 'html' };

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
// Series colors live in CSS so each theme can pick shades with enough contrast.
const fuelColors: Record<FuelId, string> = { '93': 'var(--fuel-93)', '95': 'var(--fuel-95)', '97': 'var(--fuel-97)', diesel: 'var(--fuel-diesel)' };
const fuelTerms = /combustibles?|bencin\w*|gasolin\w*|di[eé]sel|petr[oó]leo|\benap\b|\bmepco\b|crudo|brent|parafina|\bopec\b/i;
const priceContextTerms = /precio|alza|baja|ca[ií]da|sub(?:e|en|ida|ieron)|congel\w*|estabil|impuesto|subsid|paridad|\bcamioner\w*|\btransportista\w*/i;
const newsSources: NewsSource[] = [
  { endpoint: '/api/news-feed', name: 'Cooperativa', host: 'www.cooperativa.cl', format: 'rss' },
  { endpoint: '/api/news-feed-biobio', name: 'BioBioChile', host: 'www.biobiochile.cl', format: 'html' },
];
const refreshIntervalMs = 5 * 60 * 1000;
let selectedFuel: FuelId = '93';
let selectedPeriod: PeriodId = '3m';
let historyData: Observation[] = [];
let compareAll = false;
let chartIntroPlayed = false;
let historySnapshot = '';
let newsSnapshot = '';
let refreshInProgress = false;
let stationMap: FuelStationsMap | null = null;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root was not found');

app.innerHTML = `
  <main>
    <header class="site-header"><a class="site-name" href="/">Alzas de combustible en Chile</a><button class="theme-toggle" id="theme-toggle" type="button"></button></header>
    <section class="chart-section" aria-labelledby="chart-title">
      <div class="chart-heading"><div><h1 id="chart-title">¿Cuánto está la bencina hoy?</h1><p>Promedio por litro en todo Chile, según lo que informan las bencineras a la CNE.</p><a class="hero-cta" href="#stations-title">Ver bencineras cerca de mí</a></div><span class="latest-update" id="last-updated">Buscando último dato…</span></div>
      <div class="chart-toolbar"><div class="fuel-select" role="group" aria-label="Combustible">${fuels.map((fuel) => `<button type="button" data-fuel="${fuel.id}" aria-pressed="${fuel.id === selectedFuel}">${fuel.name}</button>`).join('')}<button type="button" class="compare-toggle" id="compare-toggle" aria-pressed="false">Comparar combustibles</button></div><div class="period-select" role="group" aria-label="Período">${periods.map((period) => `<button type="button" data-period="${period.id}" aria-pressed="${period.id === selectedPeriod}">${period.label}</button>`).join('')}</div></div>
      <div class="chart-card"><div class="chart-meta"><div class="chart-headline"><p class="chart-change" id="chart-period-change" data-trend="neutral" aria-live="polite"></p><span class="chart-fuel" id="chart-fuel">Gasolina 93</span><span class="chart-unit">Promedio informado por las bencineras, en pesos por litro</span><span class="chart-coverage-note" id="chart-coverage-note" hidden></span></div><span class="chart-current"><span>Último precio registrado</span><strong id="chart-last-price">—</strong></span></div><div class="chart-readout" id="chart-readout"></div><div class="chart-canvas" id="chart-canvas"><div class="chart-loading"><span class="spinner"></span><span>Cargando datos históricos…</span></div></div><div class="chart-footer"><span>Fuente: <a href="https://bencinaschile.cl/historial-precio-bencina/" target="_blank" rel="noreferrer">BencinasChile</a></span><span>Precios declarados a la CNE, con actualización diaria</span></div></div>
      <p class="source-method">Es un promedio independiente de los precios que cada bencinera informa a Bencina en Línea, de la CNE, tomando solo las estaciones con precio vigente. Cada estación fija su propio precio. <a href="https://bencinaschile.cl/fuentes-y-metodologia/" target="_blank" rel="noreferrer">Ver metodología</a></p>
    </section>
    <section class="stations-section" id="stations" aria-labelledby="stations-title">
      <div class="stations-heading"><div><h2 id="stations-title">Precios cerca de ti</h2><p>Mira cuánto cobra cada bencinera y encuentra la más barata cerca de ti.</p></div><button class="station-locate" id="station-locate" type="button"><span aria-hidden="true">◎</span> Usar mi ubicación</button></div>
      <div class="station-toolbar"><div class="fuel-select" role="group" aria-label="Combustible en el mapa">${fuels.map((fuel) => `<button type="button" data-station-fuel="${fuel.id}" aria-pressed="${fuel.id === selectedFuel}">${fuel.name}</button>`).join('')}</div><span class="station-summary" id="station-summary">Cargando estaciones…</span></div>
      <div class="station-layout"><div class="station-map-wrap"><div class="station-map" id="station-map" role="application" aria-label="Mapa de estaciones de servicio de Chile"></div><div class="station-map-status" id="station-map-status" aria-live="polite">Cargando estaciones…</div></div><aside class="nearby-panel" aria-labelledby="nearby-title"><button class="sheet-handle" id="nearby-handle" type="button" aria-expanded="false" aria-label="Cambiar altura de la lista de estaciones"><span></span></button><div class="nearby-heading"><h3 id="nearby-title">Estaciones cercanas</h3><span id="nearby-count"></span></div><div class="nearby-pinned" id="nearby-pinned"></div><div class="nearby-list" id="nearby-list"><p class="nearby-empty">Activa tu ubicación para ver las bencineras más cercanas y cuál sale más barata.</p></div></aside></div>
      <div class="station-legend"><span><i class="legend-dot legend-dot-low"></i>Menor precio</span><span><i class="legend-dot legend-dot-mid"></i>Precio intermedio</span><span><i class="legend-dot legend-dot-high"></i>Mayor precio</span><span><i class="legend-dot legend-dot-outlier"></i>Precio inusual según la fuente</span><span><i class="legend-dot legend-dot-none"></i>Sin precio</span><span><i class="legend-dot legend-dot-cheapest"></i>Más barata de la vista</span><span><i class="legend-dot legend-dot-user"></i>Tu ubicación</span></div>
      <p class="station-source">Cada bencinera informa su precio a la CNE y las ubicaciones vienen del catálogo de <a href="https://bencina.cl/fuentes-y-metodologia/" target="_blank" rel="noreferrer">Bencina.cl</a>. Tu ubicación se pide solo cuando pulsas el botón y se calcula en tu dispositivo.</p>
    </section>
    <section class="news-section" id="news-section" aria-labelledby="news-title"><div class="section-head"><div><h2 id="news-title">Noticias relacionadas</h2></div><span class="news-updated" id="news-updated">Buscando noticias recientes…</span></div><div class="news-list" id="news-list"><div class="news-state"><span class="spinner"></span><span>Cargando noticias recientes…</span></div></div></section>
  </main>
  <footer>
    <div class="footer-about"><strong>Alzas de combustible en Chile</strong><span>Precios observados y noticias enlazadas a su fuente original.</span></div>
    <p class="footer-support">¿Te sirve esta información? <a href="https://github.com/aramis2009" target="_blank" rel="noreferrer">Sígueme en GitHub</a> y apóyame a crear más webs especializadas para Chile.</p>
    <p class="footer-credit">Creado por Aramis, 2026</p>
  </footer>`;

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

function renderEmpty(message: string, detail: string, retry?: () => void): void {
  const canvas = document.querySelector<HTMLDivElement>('#chart-canvas');
  if (!canvas) return;
  canvas.innerHTML = `<div class="chart-empty"><strong>${svgSafe(message)}</strong><p>${svgSafe(detail)}</p>${retry ? '<button class="retry-button" type="button">Reintentar</button>' : ''}</div>`;
  if (retry) canvas.querySelector<HTMLButtonElement>('.retry-button')?.addEventListener('click', retry);
}

// Observations further apart than this are joined with a dashed straight segment instead of a step,
// because a step would claim the price held steady on days the source never reported.
const chartGapDays = 2;
const dayMs = 86_400_000;
const readoutDate = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Santiago' });
const tickDateFormat = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', timeZone: 'America/Santiago' });
const tickDate = { format: (date: Date): string => tickDateFormat.format(date).replace('-', ' ') };

interface ChartPoint { index: number; x: number; y: number; date: Date }
interface ChartPaths { solid: string; gaps: string; full: string }

function buildPaths(points: ChartPoint[]): ChartPaths {
  let solid = '';
  let gaps = '';
  let full = '';
  points.forEach((point, position) => {
    const at = `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    const previous = points[position - 1];
    if (!previous) {
      solid += `M${at}`;
      full += `M${at}`;
      return;
    }
    if ((point.date.getTime() - previous.date.getTime()) / dayMs > chartGapDays) {
      gaps += `M${previous.x.toFixed(1)},${previous.y.toFixed(1)}L${at}`;
      solid += `M${at}`;
      full += `L${at}`;
      return;
    }
    solid += `H${point.x.toFixed(1)}V${point.y.toFixed(1)}`;
    full += `H${point.x.toFixed(1)}V${point.y.toFixed(1)}`;
  });
  return { solid, gaps, full };
}

function renderChart(): void {
  const canvas = document.querySelector<HTMLDivElement>('#chart-canvas');
  const title = document.querySelector<HTMLElement>('#chart-fuel');
  const readout = document.querySelector<HTMLElement>('#chart-readout');
  const lastPriceLabel = document.querySelector<HTMLElement>('#chart-last-price');
  const changeLabel = document.querySelector<HTMLElement>('#chart-period-change');
  const coverageNote = document.querySelector<HTMLElement>('#chart-coverage-note');
  if (!canvas || !title || !readout || !lastPriceLabel || !changeLabel || !coverageNote) return;
  const latest = historyData.at(-1)?.date;
  if (!latest || historyData.length === 0) return;

  const period = periods.find((item) => item.id === selectedPeriod);
  if (!period) return;
  const requestedStart = monthBefore(latest, period.months);
  const inRange = historyData.filter((entry) => entry.date >= requestedStart && entry.date <= latest);
  const selected = inRange.filter((entry) => entry.prices[selectedFuel] !== null);
  // Comparing shows every fuel on the same dates, so the window follows any reported price.
  const windowObs = compareAll ? inRange.filter((entry) => fuels.some((fuel) => entry.prices[fuel.id] !== null)) : selected;
  title.textContent = fuels.find((fuel) => fuel.id === selectedFuel)?.name ?? '';
  if (selected.length === 0 || windowObs.length === 0) {
    readout.textContent = `${dateFormatter.format(requestedStart)} — ${dateFormatter.format(latest)}`;
    lastPriceLabel.textContent = '—';
    changeLabel.textContent = 'Variación no disponible';
    changeLabel.dataset.trend = 'neutral';
    coverageNote.hidden = true;
    renderEmpty('No hay datos para este período', 'La fuente no publicó precios en estas fechas. Prueba con un período más largo.');
    return;
  }

  const start = windowObs[0]?.date ?? requestedStart;
  const end = windowObs.at(-1)?.date ?? latest;
  const limitedCoverage = start.getTime() > requestedStart.getTime();
  coverageNote.hidden = !limitedCoverage;
  coverageNote.textContent = limitedCoverage ? `Hay datos solo desde el ${dateFormatter.format(start)}.` : '';
  const rangeText = `${dateFormatter.format(start)} — ${dateFormatter.format(end)}`;
  readout.dataset.range = rangeText;

  const latestPrice = selected.at(-1)?.prices[selectedFuel];
  const firstPrice = selected[0]?.prices[selectedFuel];
  lastPriceLabel.textContent = latestPrice === null || latestPrice === undefined ? '—' : `$${formatPrice(latestPrice)} /L`;
  if (selected.length < 2 || firstPrice === null || firstPrice === undefined || latestPrice === null || latestPrice === undefined) {
    changeLabel.textContent = 'Variación no disponible';
    changeLabel.dataset.trend = 'neutral';
  } else {
    const priceChange = latestPrice - firstPrice;
    const percentage = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs((priceChange / firstPrice) * 100));
    const span = limitedCoverage ? `desde el ${tickDate.format(start)}` : `en ${period.label}`;
    const verb = priceChange > 0 ? 'Subió' : priceChange < 0 ? 'Bajó' : 'Sin cambios';
    changeLabel.dataset.trend = priceChange > 0 ? 'up' : priceChange < 0 ? 'down' : 'neutral';
    changeLabel.innerHTML = priceChange === 0
      ? `<span>Sin cambios ${span}</span>`
      : `<span>${verb} $${formatPrice(Math.abs(priceChange))} por litro ${span}</span><span class="chart-change-pct">${priceChange > 0 ? '+' : '−'}${percentage}%</span>`;
  }

  // One SVG unit equals one CSS pixel, so labels keep a readable size on phones.
  const width = Math.max(280, Math.round(canvas.clientWidth || 1000));
  const height = Math.max(200, Math.round(canvas.clientHeight || 380));
  const left = 64;
  const right = width - 22;
  const top = 26;
  const bottom = height - 38;
  const values = (compareAll ? fuels : fuels.filter((fuel) => fuel.id === selectedFuel))
    .flatMap((fuel) => windowObs.flatMap((entry) => entry.prices[fuel.id] ?? []));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max(12, (maxValue - minValue) * 0.09);
  const lower = Math.floor((minValue - padding) / 50) * 50;
  const upper = Math.ceil((maxValue + padding) / 50) * 50;
  const valueRange = Math.max(1, upper - lower);
  const timeRange = Math.max(1, end.getTime() - start.getTime());
  const x = (date: Date): number => left + ((date.getTime() - start.getTime()) / timeRange) * (right - left);
  const y = (value: number): number => bottom - ((value - lower) / valueRange) * (bottom - top);
  const seriesPoints = (fuel: FuelId): ChartPoint[] => windowObs.flatMap((entry, index) => {
    const price = entry.prices[fuel];
    return price === null ? [] : [{ index, x: x(entry.date), y: y(price), date: entry.date }];
  });
  const drawn = compareAll ? fuels.map((fuel) => fuel.id) : [selectedFuel];
  const yTicks = Array.from({ length: 5 }, (_, index) => lower + (valueRange * index) / 4);
  const tickCount = width < 560 ? 3 : 5;
  const xTicks = Array.from({ length: tickCount }, (_, index) => {
    const date = new Date(start.getTime() + (timeRange * index) / (tickCount - 1));
    return { x: x(date), label: tickDate.format(date) };
  });
  const arm = 12;
  const crop = [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]]
    .map(([cx, cy, dx, dy]) => `M${cx! + dx! * arm},${cy}H${cx}V${cy! + dy! * arm}`).join('');
  const selectedPoints = seriesPoints(selectedFuel);
  const selectedPaths = buildPaths(selectedPoints);
  const lastPoint = selectedPoints.at(-1);
  if (!lastPoint) return;
  const hasGaps = drawn.some((fuel) => buildPaths(seriesPoints(fuel)).gaps !== '');
  const lines = drawn.map((fuel) => {
    const paths = buildPaths(seriesPoints(fuel));
    const emphasis = !compareAll || fuel === selectedFuel ? ' is-selected' : '';
    return `<g class="chart-series${emphasis}" style="--series:${fuelColors[fuel]}"><path class="chart-line chart-gap" d="${paths.gaps}"/><path class="chart-line" d="${paths.solid}"/></g>`;
  }).join('');
  const area = compareAll ? '' : `<path class="chart-area" d="${selectedPaths.full} L${lastPoint.x.toFixed(1)},${bottom} L${(selectedPoints[0]?.x ?? left).toFixed(1)},${bottom} Z" style="fill:url(#chart-fade)"/>`;
  const label = `${compareAll ? 'Los 4 combustibles' : (fuels.find((fuel) => fuel.id === selectedFuel)?.name ?? '')}: precios por litro entre ${dateFormatter.format(start)} y ${dateFormatter.format(end)}. Usa las flechas para recorrer los días.`;
  const firstRender = !chartIntroPlayed;
  chartIntroPlayed = true;
  canvas.innerHTML = `<svg class="chart-svg${firstRender ? ' intro' : ''}" viewBox="0 0 ${width} ${height}" style="--series:${fuelColors[selectedFuel]}" tabindex="0" role="group" aria-label="${svgSafe(label)}">
    <defs>
      <clipPath id="chart-reveal"><rect class="chart-reveal" x="${left - 4}" y="0" width="${right - left + 8}" height="${height}"/></clipPath>
      <linearGradient id="chart-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--series);stop-opacity:.3"/><stop offset="1" style="stop-color:var(--series);stop-opacity:0"/></linearGradient>
    </defs>
    ${yTicks.map((tick) => `<line class="gridline" x1="${left}" y1="${y(tick).toFixed(1)}" x2="${right}" y2="${y(tick).toFixed(1)}"/><text class="axis-label" x="${left - 12}" y="${(y(tick) + 5).toFixed(1)}" text-anchor="end">$${formatPrice(tick)}</text>`).join('')}
    ${xTicks.map((tick, index) => `<line class="gridline gridline-v" x1="${tick.x.toFixed(1)}" y1="${top}" x2="${tick.x.toFixed(1)}" y2="${bottom + 6}"/><text class="date-tick" x="${tick.x.toFixed(1)}" y="${bottom + 26}" text-anchor="${index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle'}">${tick.label}</text>`).join('')}
    <path class="crop-marks" d="${crop}"/>
    <g clip-path="url(#chart-reveal)">${area}${lines}</g>
    ${compareAll ? '' : `<circle class="chart-endpoint-ring" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="8"/><circle class="chart-endpoint" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="4"/>`}
    <g class="chart-cross" hidden>
      <line class="cross-v" y1="${top}" y2="${bottom}"/>
      ${drawn.map((fuel) => `<circle class="cross-dot" data-fuel="${fuel}" r="5.5" style="--series:${fuelColors[fuel]}"/>`).join('')}
      ${compareAll ? '' : `<g class="cross-tag cross-tag-y"><rect x="${left - 62}" y="-12" width="58" height="24" rx="4"/><text x="${left - 33}" y="5" text-anchor="middle"></text></g>`}
      <g class="cross-tag cross-tag-x"><rect x="-34" y="${bottom + 8}" width="68" height="24" rx="4"/><text x="0" y="${bottom + 25}" text-anchor="middle"></text></g>
    </g>
    <rect class="chart-hit" x="${left}" y="${top - 6}" width="${right - left}" height="${bottom - top + 12}"/>
  </svg>`;

  const svg = canvas.querySelector<SVGSVGElement>('.chart-svg');
  const cross = svg?.querySelector<SVGGElement>('.chart-cross');
  const hit = svg?.querySelector<SVGRectElement>('.chart-hit');
  if (!svg || !cross || !hit) return;
  const pointsByFuel = new Map(drawn.map((fuel) => [fuel, seriesPoints(fuel)]));
  const xs = windowObs.map((entry) => x(entry.date));
  const nameOf = (fuel: FuelId): string => fuels.find((item) => item.id === fuel)?.name ?? fuel;
  let active: number | null = null;

  const setActive = (index: number | null): void => {
    active = index;
    const observation = index === null ? undefined : windowObs[index];
    if (index === null || !observation) {
      cross.setAttribute('hidden', '');
      readout.className = 'chart-readout';
      readout.innerHTML = `<span>${rangeText}</span><span class="readout-hint">Recorre el gráfico para ver cada día.${hasGaps ? ' La línea punteada une fechas sin dato publicado.' : ''}</span>`;
      return;
    }
    cross.removeAttribute('hidden');
    const cx = xs[index] ?? left;
    cross.querySelector('.cross-v')?.setAttribute('transform', `translate(${cx.toFixed(1)} 0)`);
    cross.querySelectorAll<SVGCircleElement>('.cross-dot').forEach((dot) => {
      const point = pointsByFuel.get(dot.dataset.fuel as FuelId)?.find((candidate) => candidate.index === index);
      if (point) {
        dot.removeAttribute('hidden');
        dot.setAttribute('cx', point.x.toFixed(1));
        dot.setAttribute('cy', point.y.toFixed(1));
      } else {
        dot.setAttribute('hidden', '');
      }
    });
    const dateTag = cross.querySelector<SVGGElement>('.cross-tag-x');
    const dateText = tickDate.format(observation.date);
    if (dateTag) {
      const tagX = Math.min(Math.max(cx, left + 34), right - 34);
      dateTag.setAttribute('transform', `translate(${tagX.toFixed(1)} 0)`);
      const text = dateTag.querySelector('text');
      if (text) text.textContent = dateText;
    }
    const price = observation.prices[selectedFuel];
    const priceTag = cross.querySelector<SVGGElement>('.cross-tag-y');
    if (priceTag && price !== null) {
      priceTag.setAttribute('transform', `translate(0 ${y(price).toFixed(1)})`);
      const text = priceTag.querySelector('text');
      if (text) text.textContent = `$${formatPrice(price)}`;
    }
    readout.className = 'chart-readout is-active';
    if (compareAll) {
      readout.innerHTML = `<span class="readout-date">${readoutDate.format(observation.date)}</span>${fuels.map((fuel) => {
        const value = observation.prices[fuel.id];
        return `<span class="readout-fuel${fuel.id === selectedFuel ? ' is-selected' : ''}" style="--series:${fuelColors[fuel.id]}"><i></i>${nameOf(fuel.id)} <strong>${value === null ? '—' : `$${formatPrice(value)}`}</strong></span>`;
      }).join('')}`;
      return;
    }
    const previous = windowObs[index - 1];
    const previousPrice = previous?.prices[selectedFuel];
    let delta = '';
    if (previous && previousPrice !== null && previousPrice !== undefined && price !== null) {
      const diff = price - previousPrice;
      const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral';
      const verb = diff > 0 ? `Subió $${formatPrice(diff)}` : diff < 0 ? `Bajó $${formatPrice(Math.abs(diff))}` : 'Sin cambios';
      delta = `<span class="readout-delta" data-trend="${trend}">${verb} desde el ${tickDate.format(previous.date)}</span>`;
    }
    readout.innerHTML = `<span class="readout-date">${readoutDate.format(observation.date)}</span><strong class="readout-price">${price === null ? '—' : `$${formatPrice(price)} /L`}</strong>${delta}`;
  };

  const nearest = (event: PointerEvent): number => {
    const box = svg.getBoundingClientRect();
    const position = ((event.clientX - box.left) / Math.max(1, box.width)) * width;
    let best = 0;
    xs.forEach((value, index) => {
      if (Math.abs(value - position) < Math.abs((xs[best] ?? 0) - position)) best = index;
    });
    return best;
  };
  hit.addEventListener('pointermove', (event) => { readout.setAttribute('aria-live', 'off'); setActive(nearest(event)); });
  hit.addEventListener('pointerdown', (event) => { readout.setAttribute('aria-live', 'off'); setActive(nearest(event)); });
  // Touch readings stay until the next tap so the value can be read after lifting the finger.
  hit.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') setActive(null); });
  svg.addEventListener('keydown', (event) => {
    const last = windowObs.length - 1;
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step === 0 && event.key !== 'Home' && event.key !== 'End' && event.key !== 'Escape') return;
    event.preventDefault();
    readout.setAttribute('aria-live', 'polite');
    if (event.key === 'Escape') setActive(null);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else setActive(Math.min(last, Math.max(0, (active ?? last + (step > 0 ? 0 : 1)) + step)));
  });
  svg.addEventListener('blur', () => setActive(null));
  setActive(null);
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

function isRelevantNews(title: string, description = ''): boolean {
  if (fuelTerms.test(title)) return true;
  const content = `${title} ${description}`;
  return fuelTerms.test(description) && priceContextTerms.test(content);
}

const newsVisibleCount = 6;
let newsExpanded = false;

function setNewsVisible(visible: boolean): void {
  const section = document.querySelector<HTMLElement>('#news-section');
  if (section) section.hidden = !visible;
}

function renderNews(items: NewsItem[]): void {
  const list = document.querySelector<HTMLDivElement>('#news-list');
  if (!list) return;
  const [featured, ...rest] = items;
  // News is context, not the main content: with nothing to show the whole section is hidden instead of announcing an empty state.
  setNewsVisible(Boolean(featured));
  if (!featured) {
    list.innerHTML = '';
    return;
  }
  const meta = (item: NewsItem): string => `<div class="news-meta"><span>${svgSafe(item.source)}</span><time datetime="${item.publishedAt.toISOString()}">${dateFormatter.format(item.publishedAt)}</time></div>`;
  const image = featured.image ? `<a class="news-feature-image" href="${svgSafe(featured.href)}" target="_blank" rel="noreferrer" tabindex="-1" aria-hidden="true"><img src="${svgSafe(featured.image)}" alt="" loading="lazy"></a>` : '';
  const headlines = rest.map((item, index) => `<li class="news-headline"${index + 1 >= newsVisibleCount && !newsExpanded ? ' hidden' : ''}>${meta(item)}<a href="${svgSafe(item.href)}" target="_blank" rel="noreferrer">${svgSafe(item.title)}</a></li>`).join('');
  const more = items.length > newsVisibleCount
    ? `<button class="news-more" id="news-more" type="button" aria-expanded="${newsExpanded}">${newsExpanded ? 'Ver menos noticias' : 'Ver más noticias'}</button>`
    : '';
  list.innerHTML = `<article class="news-feature${featured.image ? '' : ' news-feature-no-image'}">${image}<div class="news-copy">${meta(featured)}<h3><a href="${svgSafe(featured.href)}" target="_blank" rel="noreferrer">${svgSafe(featured.title)}</a></h3><p>${svgSafe(featured.summary)}</p><a class="read-link" href="${svgSafe(featured.href)}" target="_blank" rel="noreferrer">Leer la nota original</a></div></article><ol class="news-headlines">${headlines}</ol>${more}`;
  list.querySelector<HTMLButtonElement>('#news-more')?.addEventListener('click', (event) => {
    newsExpanded = !newsExpanded;
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute('aria-expanded', String(newsExpanded));
    button.textContent = newsExpanded ? 'Ver menos noticias' : 'Ver más noticias';
    list.querySelectorAll<HTMLLIElement>('.news-headline').forEach((item, index) => {
      item.hidden = !newsExpanded && index + 1 >= newsVisibleCount;
    });
  });
}

async function loadNewsSource(source: NewsSource): Promise<NewsItem[]> {
  const response = await fetch(source.endpoint, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${source.name} feed responded with ${response.status}`);
  const content = await response.text();
  if (source.format === 'html') return loadBioBioNews(content, source);
  const xml = new DOMParser().parseFromString(content, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error(`${source.name} feed XML could not be parsed`);
  return [...xml.querySelectorAll('channel > item')].flatMap((item): NewsItem[] => {
    const title = item.querySelector('title')?.textContent?.trim() ?? '';
    const href = item.querySelector('link')?.textContent?.trim() ?? '';
    const publishedAt = new Date(item.querySelector('pubDate')?.textContent?.trim() ?? '');
    const description = plainText(
      item.querySelector('description')?.textContent
        ?? item.getElementsByTagNameNS('http://purl.org/rss/1.0/modules/content/', 'encoded').item(0)?.textContent
        ?? '',
    );
    if (!title || !isRelevantNews(title, description) || Number.isNaN(publishedAt.getTime())) return [];
    try {
      if (new URL(href).hostname !== source.host) return [];
    } catch {
      return [];
    }
    return [{ title, href, source: source.name, publishedAt, summary: summarize(description), image: itemImage(item) }];
  });
}

function loadBioBioNews(html: string, source: NewsSource): Promise<NewsItem[]> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidates = [...doc.querySelectorAll<HTMLElement>('article.article')].flatMap((article) => {
    const titleElement = article.querySelector<HTMLElement>('.article-title');
    const anchor = titleElement?.closest<HTMLAnchorElement>('a[href]') ?? article.closest<HTMLAnchorElement>('a[href]');
    const title = titleElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!anchor || !isRelevantNews(title)) return [];
    try {
      const articleUrl = new URL(anchor.href);
      if (articleUrl.hostname !== source.host) return [];
      const dateMatch = articleUrl.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (!dateMatch) return [];
      const imageMatch = article.querySelector<HTMLElement>('.article-image')?.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      return [{
        title,
        href: articleUrl.toString(),
        publishedAt: new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T12:00:00-03:00`),
        image: imageMatch?.[1],
      }];
    } catch {
      return [];
    }
  });
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.href, candidate])).values()].slice(0, 10);

  return Promise.all(uniqueCandidates.map(async (candidate): Promise<NewsItem> => {
    try {
      const articlePath = new URL(candidate.href).pathname;
      const response = await fetch(`/api/article-biobio${articlePath}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Article details are unavailable');
      const articleDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const description = articleDoc.querySelector<HTMLMetaElement>('meta[property="og:description"], meta[name="description"]')?.content ?? '';
      const published = articleDoc.querySelector<HTMLMetaElement>('meta[property="article:published_time"]')?.content;
      const parsedDate = published ? new Date(published) : candidate.publishedAt;
      return {
        ...candidate,
        source: source.name,
        publishedAt: Number.isNaN(parsedDate.getTime()) ? candidate.publishedAt : parsedDate,
        summary: summarize(plainText(description) || 'Lee la nota original para conocer los detalles.'),
      };
    } catch {
      return { ...candidate, source: source.name, summary: 'Lee la nota original para conocer los detalles.' };
    }
  }));
}

function deduplicateNews(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  return items.filter((item) => {
    const normalizedTitle = item.title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const normalizedUrl = new URL(item.href);
    normalizedUrl.hash = '';
    normalizedUrl.search = '';
    const urlKey = normalizedUrl.toString().replace(/\/$/, '');
    if (seenUrls.has(urlKey) || seenTitles.has(normalizedTitle)) return false;
    seenUrls.add(urlKey);
    seenTitles.add(normalizedTitle);
    return true;
  });
}

async function loadHistory(): Promise<void> {
  const updated = document.querySelector<HTMLElement>('#last-updated');
  try {
    const response = await fetch('/api/fuel-history', { headers: { Accept: 'text/html' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Historical source responded with ${response.status}`);
    const result = parseHistory(await response.text());
    const snapshot = JSON.stringify(result.observations.map(({ date, prices }) => [date.getTime(), prices]));
    if (updated) updated.innerHTML = `Último dato del <b>${dateFormatter.format(result.latestDate)}</b>. Se actualiza solo cada 5 minutos.`;
    if (snapshot === historySnapshot) return;
    historySnapshot = snapshot;
    historyData = result.observations;
    renderChart();
  } catch {
    // Keep the last good chart when a refresh fails; the full error only appears when there is nothing to show.
    if (historyData.length > 0) {
      if (updated) updated.textContent = 'No pudimos actualizar el historial. Estás viendo el último dato guardado.';
      return;
    }
    historySnapshot = '';
    renderEmpty('No pudimos cargar el historial de precios', 'La fuente no respondió. Prueba de nuevo en un momento.', () => void loadHistory());
    if (updated) updated.textContent = '';
  }
}

async function loadNews(): Promise<void> {
  const list = document.querySelector<HTMLDivElement>('#news-list');
  const updated = document.querySelector<HTMLElement>('#news-updated');
  try {
    const results = await Promise.allSettled(newsSources.map(loadNewsSource));
    const successfulFeeds = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const successfulCount = results.filter((result) => result.status === 'fulfilled').length;
    if (successfulCount === 0) throw new Error('No news feeds responded');
    const items = deduplicateNews(successfulFeeds.flat())
      .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
      .slice(0, 12);
    const snapshot = JSON.stringify(items.map((item) => [item.title, item.href, item.publishedAt.getTime(), item.summary, item.image, item.source]));
    if (snapshot !== newsSnapshot) {
      newsSnapshot = snapshot;
      renderNews(items);
    }
    const sourceStatus = successfulCount === newsSources.length
      ? successfulCount + ' fuentes'
      : successfulCount + ' de ' + newsSources.length + ' fuentes';
    const checkedAt = new Intl.DateTimeFormat('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Santiago',
    }).format(new Date());
    if (updated) updated.textContent = `${sourceStatus}, revisadas a las ${checkedAt}`;
  } catch {
    newsSnapshot = '';
    setNewsVisible(false);
    if (list) list.innerHTML = '';
    if (updated) updated.textContent = '';
  }
}

function selectFuel(fuel: FuelId): void {
  selectedFuel = fuel;
  document.querySelectorAll('[data-fuel]').forEach((item) => item.setAttribute('aria-pressed', String(item.getAttribute('data-fuel') === fuel)));
  document.querySelectorAll('[data-station-fuel]').forEach((item) => item.setAttribute('aria-pressed', String(item.getAttribute('data-station-fuel') === fuel)));
  renderChart();
  stationMap?.setFuel(fuel);
}

document.querySelectorAll<HTMLButtonElement>('[data-fuel]').forEach((button) => {
  button.addEventListener('click', () => {
    const id = button.dataset.fuel;
    if (id !== '93' && id !== '95' && id !== '97' && id !== 'diesel') return;
    selectFuel(id);
  });
});
document.querySelector<HTMLButtonElement>('#compare-toggle')?.addEventListener('click', (event) => {
  compareAll = !compareAll;
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-pressed', String(compareAll));
  renderChart();
});
let chartWidth = 0;
const chartCanvas = document.querySelector<HTMLDivElement>('#chart-canvas');
if (chartCanvas && 'ResizeObserver' in window) {
  new ResizeObserver(() => {
    const width = Math.round(chartCanvas.clientWidth);
    if (width === chartWidth) return;
    chartWidth = width;
    window.requestAnimationFrame(renderChart);
  }).observe(chartCanvas);
}
document.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((button) => {
  button.addEventListener('click', () => {
    const id = button.dataset.period;
    if (id !== '1m' && id !== '3m' && id !== '6m' && id !== '1y') return;
    selectedPeriod = id;
    document.querySelectorAll('[data-period]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderChart();
  });
});

const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeColors = { dark: '#0a1628', light: '#e9eef6' };

function currentTheme(): 'dark' | 'light' {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark' || forced === 'light') return forced;
  return themeQuery.matches ? 'dark' : 'light';
}

function syncThemeControls(): void {
  const theme = currentTheme();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
  if (!themeToggle) return;
  themeToggle.textContent = theme === 'dark' ? 'Tema claro' : 'Tema oscuro';
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
}

themeToggle?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    // Storage can be blocked; the choice then lasts only for this visit.
  }
  syncThemeControls();
});
themeQuery.addEventListener('change', syncThemeControls);
syncThemeControls();
stationMap = new FuelStationsMap(selectedFuel, selectFuel);

async function refreshSources(): Promise<void> {
  if (refreshInProgress || document.visibilityState === 'hidden') return;
  refreshInProgress = true;
  try {
    await Promise.all([loadHistory(), loadNews(), stationMap?.refresh() ?? Promise.resolve()]);
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
