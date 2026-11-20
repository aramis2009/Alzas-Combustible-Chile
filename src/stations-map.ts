import * as L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import twemoji from '@twemoji/api';

export type FuelId = '93' | '95' | '97' | 'diesel';
type FuelOffer = { fuel: FuelId; service: 'asistido' | 'autoservicio'; price: number; reportedAt: Date | null; status: 'ok' | 'high' | 'suspicious_low' };
type Station = { id: string; brand: string; address: string; commune: string; latitude: number; longitude: number; offers: FuelOffer[] };
type ParsedCatalogue = { stations: Station[]; checkedAt: Date };
// distanceKm is null while ranking the visible area instead of the user's surroundings.
type LocatedStation = { station: Station; offer: FuelOffer; distanceKm: number | null };

const fuelLabels: Record<FuelId, string> = { '93': 'Gasolina 93', '95': 'Gasolina 95', '97': 'Gasolina 97', diesel: 'Diésel' };
const fuelIndexes: FuelId[] = ['93', '95', '97', 'diesel'];
const statusNames: FuelOffer['status'][] = ['ok', 'high', 'suspicious_low'];
// Prices appear on the pins from city scale; below that the map shows dots and clusters.
const labelZoom = 11;
// Below this zoom the visible area is too large for a ranking of it to mean anything.
const zoneZoom = 9;
const chileBounds: L.LatLngBoundsExpression = [[-56.5, -76], [-17, -66]];
const numberFormatter = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const dateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Santiago',
});

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatPrice(value: number): string {
  return `$${numberFormatter.format(value)}`;
}

function sourceTime(value: unknown): Date | null {
  return isNumber(value) ? new Date(value * 60_000) : null;
}

function parseCatalogue(value: unknown): ParsedCatalogue {
  if (!isRecord(value) || !isNumber(value.t) || !isArray(value.c) || !isArray(value.s)) {
    throw new Error('The station catalogue has an invalid structure');
  }

  const communes = value.c.map((entry) => {
    if (!isArray(entry) || typeof entry[1] !== 'string') return '';
    return entry[1];
  });
  const stations = value.s.flatMap((entry): Station[] => {
    if (!isArray(entry) || entry.length < 7) return [];
    const [id, brand, address, communeIndex, latitude, longitude, rawOffers] = entry;
    if (
      typeof id !== 'string'
      || typeof brand !== 'string'
      || typeof address !== 'string'
      || !isNumber(communeIndex)
      || !isNumber(latitude)
      || !isNumber(longitude)
      || !isArray(rawOffers)
      || latitude < -56 || latitude > -17 || longitude < -76 || longitude > -66
    ) return [];

    const offers = rawOffers.flatMap((rawOffer): FuelOffer[] => {
      if (!isArray(rawOffer) || rawOffer.length < 5) return [];
      const [fuelIndex, serviceIndex, price, reportedAt, statusIndex] = rawOffer;
      if (
        !isNumber(fuelIndex)
        || !isNumber(serviceIndex)
        || !isNumber(price)
        || !Number.isInteger(fuelIndex)
        || fuelIndex < 0
        || fuelIndex >= fuelIndexes.length
        || (serviceIndex !== 0 && serviceIndex !== 1)
        || price < 200
        || price > 10_000
      ) return [];
      const status = isNumber(statusIndex) ? statusNames[statusIndex] ?? 'ok' : 'ok';
      return [{
        fuel: fuelIndexes[fuelIndex] ?? '93',
        service: serviceIndex === 0 ? 'asistido' : 'autoservicio',
        price,
        reportedAt: sourceTime(reportedAt),
        status,
      }];
    });

    return [{
      id,
      brand,
      address,
      commune: communes[communeIndex] || 'Chile',
      latitude,
      longitude,
      offers,
    }];
  });

  const checkedAt = new Date(value.t);
  if (Number.isNaN(checkedAt.getTime())) throw new Error('The station catalogue update time is invalid');
  return { stations, checkedAt };
}

function bestOffer(station: Station, fuel: FuelId): FuelOffer | null {
  const offers = station.offers.filter((offer) => offer.fuel === fuel);
  return offers.find((offer) => offer.service === 'asistido')
    ?? offers.find((offer) => offer.service === 'autoservicio')
    ?? null;
}

function distanceBetween(origin: L.LatLng, latitude: number, longitude: number): number {
  return origin.distanceTo([latitude, longitude]) / 1000;
}

function textLine(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}

export class FuelStationsMap {
  private readonly map: L.Map;
  private readonly markers: L.MarkerClusterGroup;
  private readonly stationMarkers = new Map<string, L.Marker>();
  private readonly locationLayer = L.layerGroup();
  private readonly summaryElement: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly nearbyList: HTMLOListElement | HTMLDivElement;
  private readonly nearbyCount: HTMLElement;
  private readonly locationButton: HTMLButtonElement;
  private readonly fuelChange: (fuel: FuelId) => void;
  private stations: Station[] = [];
  private selectedFuel: FuelId;
  private userLocation: L.LatLng | null = null;
  private selectedStationId: string | null = null;
  private checkedAt: Date | null = null;
  private snapshot = '';
  private lastLabelZoom = false;
  private isLoading = false;
  private hasFittedBounds = false;
  private markersReady = false;
  private pendingStationId: string | null = null;
  private cheapestId: string | null = null;
  private cheapestTimer = 0;
  private readonly nearbyPinned: HTMLElement;
  private readonly layoutElement: HTMLElement;
  private readonly panelElement: HTMLElement;
  private sheetState: 'collapsed' | 'half' | 'full' = 'collapsed';
  private readonly nearbyTitle: HTMLElement;
  private locationNotice = '';
  private suppressRankingUntil = 0;

  constructor(initialFuel: FuelId, onFuelChange: (fuel: FuelId) => void) {
    const mapElement = document.querySelector<HTMLDivElement>('#station-map');
    const summaryElement = document.querySelector<HTMLElement>('#station-summary');
    const statusElement = document.querySelector<HTMLElement>('#station-map-status');
    const nearbyList = document.querySelector<HTMLDivElement>('#nearby-list');
    const nearbyCount = document.querySelector<HTMLElement>('#nearby-count');
    const locationButton = document.querySelector<HTMLButtonElement>('#station-locate');
    const nearbyPinned = document.querySelector<HTMLElement>('#nearby-pinned');
    const nearbyTitle = document.querySelector<HTMLElement>('#nearby-title');
    const layoutElement = document.querySelector<HTMLElement>('.station-layout');
    const panelElement = document.querySelector<HTMLElement>('.nearby-panel');
    if (!nearbyPinned || !nearbyTitle || !layoutElement || !panelElement || !mapElement || !summaryElement || !statusElement || !nearbyList || !nearbyCount || !locationButton) {
      throw new Error('The station map container is incomplete');
    }

    this.summaryElement = summaryElement;
    this.statusElement = statusElement;
    this.nearbyList = nearbyList;
    this.nearbyCount = nearbyCount;
    this.locationButton = locationButton;
    this.nearbyPinned = nearbyPinned;
    this.nearbyTitle = nearbyTitle;
    this.layoutElement = layoutElement;
    this.panelElement = panelElement;
    this.selectedFuel = initialFuel;
    this.fuelChange = onFuelChange;
    this.map = L.map(mapElement, { zoomControl: false, minZoom: 3, maxZoom: 18, zoomSnap: 0.25 }).setView([-35.7, -71.2], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(this.map);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.markers = L.markerClusterGroup({
      chunkedLoading: true,
      // Wider radius once pins carry price labels, so neighbouring labels do not overlap.
      maxClusterRadius: (zoom) => zoom < 9 ? 46 : zoom < labelZoom ? 40 : 64,
      showCoverageOnHover: false,
      chunkProgress: (processedMarkers, totalMarkers) => {
        if (processedMarkers === totalMarkers) {
          this.markersReady = true;
          this.focusPendingStation();
        }
      },
      iconCreateFunction: (cluster) => L.divIcon({
        className: 'station-cluster-icon',
        html: `<span>${numberFormatter.format(cluster.getChildCount())}</span>`,
        iconSize: [36, 36],
      }),
    }).addTo(this.map);
    this.locationLayer.addTo(this.map);
    this.lastLabelZoom = this.map.getZoom() >= labelZoom;
    // Cluster regrouping finishes shortly after the map stops, so the highlight waits for it.
    this.map.on('moveend', () => {
      window.clearTimeout(this.cheapestTimer);
      this.cheapestTimer = window.setTimeout(() => {
        this.updateCheapestInView();
        // Without a location the ranking follows what the map shows, except right after picking a station from it.
        if (!this.userLocation && Date.now() > this.suppressRankingUntil) this.renderNearbyStations();
      }, 380);
    });
    this.initSheet();
    this.map.on('zoomend', () => {
      const shouldShowPrices = this.map.getZoom() >= labelZoom;
      if (shouldShowPrices !== this.lastLabelZoom) {
        this.lastLabelZoom = shouldShowPrices;
        this.updateMarkerLabels();
      }
    });
    this.locationButton.addEventListener('click', () => this.requestLocation());
    document.querySelectorAll<HTMLButtonElement>('[data-station-fuel]').forEach((button) => {
      button.addEventListener('click', () => {
        const fuel = button.dataset.stationFuel;
        if (!this.isFuelId(fuel)) return;
        this.fuelChange(fuel);
      });
    });
    this.setFuel(initialFuel);
    window.requestAnimationFrame(() => this.map.invalidateSize());
  }

  setFuel(fuel: FuelId): void {
    this.selectedFuel = fuel;
    document.querySelectorAll<HTMLButtonElement>('[data-station-fuel]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.stationFuel === fuel));
    });
    if (this.stations.length > 0) this.renderStations();
  }

  async refresh(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;
    this.locationButton.disabled = true;
    try {
      const pageResponse = await fetch('/api/stations-source', { cache: 'no-store' });
      if (!pageResponse.ok) throw new Error(`Station source page returned ${pageResponse.status}`);
      const sourcePage = new DOMParser().parseFromString(await pageResponse.text(), 'text/html');
      const sourcePath = sourcePage.querySelector<HTMLElement>('[data-stations-src]')?.dataset.stationsSrc;
      if (!sourcePath) throw new Error('The source page did not expose its station catalogue');
      const fileName = new URL(sourcePath, 'https://bencina.cl').pathname.split('/').at(-1) ?? '';
      if (!/^stations-[a-zA-Z0-9_-]+\.json$/.test(fileName)) throw new Error('The station catalogue path is invalid');

      const dataResponse = await fetch(`/api/stations-data/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
      if (!dataResponse.ok) throw new Error(`Station catalogue returned ${dataResponse.status}`);
      const sourceData: unknown = await dataResponse.json();
      const parsed = parseCatalogue(sourceData);
      const snapshot = `${fileName}:${parsed.checkedAt.getTime()}:${parsed.stations.length}`;
      this.checkedAt = parsed.checkedAt;
      if (snapshot !== this.snapshot) {
        this.snapshot = snapshot;
        this.stations = parsed.stations;
        this.renderStations();
        if (!this.hasFittedBounds) {
          this.map.fitBounds(chileBounds, { padding: [18, 18], maxZoom: 6 });
          this.hasFittedBounds = true;
        }
      } else {
        this.updateSummary();
      }
      this.statusElement.textContent = this.userLocation
        ? 'Tu ubicación se usa solo en este dispositivo para ordenar las bencineras cercanas.'
        : 'El mapa muestra las bencineras de todo Chile. Tu ubicación se usa solo si la compartes.';
      this.statusElement.hidden = true;
    } catch {
      if (this.stations.length === 0) this.summaryElement.textContent = '';
      this.showStatus(this.stations.length > 0 ? 'No pudimos actualizar los precios. Estás viendo los últimos datos guardados.' : 'No pudimos cargar los precios de las bencineras. Prueba de nuevo en un momento.', true);
      if (this.stations.length === 0) this.renderNearbyEmpty('Todavía no hay precios para mostrar.');
    } finally {
      this.locationButton.disabled = false;
      this.isLoading = false;
    }
  }

  private showStatus(message: string, retry = false): void {
    this.statusElement.replaceChildren(document.createTextNode(message));
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'retry-button';
      button.textContent = 'Reintentar';
      button.addEventListener('click', () => void this.refresh());
      this.statusElement.append(button);
    }
    this.statusElement.hidden = false;
  }

  private isFuelId(value: string | undefined): value is FuelId {
    return value === '93' || value === '95' || value === '97' || value === 'diesel';
  }

  private selectedOffer(station: Station): FuelOffer | null {
    return bestOffer(station, this.selectedFuel);
  }

  private renderStations(): void {
    this.cheapestId = null;
    this.renderMarkers();
    this.renderNearbyStations();
    this.updateSummary();
    this.updateCheapestInView();
  }

  private updateSummary(): void {
    const stationsWithPrice = this.stations.filter((station) => this.selectedOffer(station) !== null).length;
    const freshness = this.checkedAt ? `Datos del ${dateTimeFormatter.format(this.checkedAt)}` : 'Datos de la CNE';
    this.summaryElement.textContent = `${numberFormatter.format(this.stations.length)} bencineras en el mapa, ${numberFormatter.format(stationsWithPrice)} con precio de ${fuelLabels[this.selectedFuel]}. ${freshness}`;
  }

  private priceThresholds(): { low: number; high: number } {
    const prices = this.stations.flatMap((station) => {
      const offer = this.selectedOffer(station);
      return offer && offer.status !== 'suspicious_low' ? [offer.price] : [];
    }).sort((left, right) => left - right);
    if (prices.length === 0) return { low: 0, high: 0 };
    return {
      low: prices[Math.floor((prices.length - 1) * 0.33)] ?? prices[0] ?? 0,
      high: prices[Math.floor((prices.length - 1) * 0.67)] ?? prices.at(-1) ?? 0,
    };
  }

  private renderMarkers(): void {
    if (this.stations.length === 0) return;
    this.markersReady = false;
    const thresholds = this.priceThresholds();
    const showPrice = this.map.getZoom() >= labelZoom;
    this.stationMarkers.clear();
    const markers = this.stations.map((station) => {
      const offer = this.selectedOffer(station);
      const marker = L.marker([station.latitude, station.longitude], { icon: this.createStationIcon(offer, thresholds, showPrice, station.id === this.cheapestId), zIndexOffset: station.id === this.cheapestId ? 800 : 0 });
      marker.bindPopup(this.createPopup(station, offer), { minWidth: 230, maxWidth: 290, autoPanPadding: [18, 18] });
      this.stationMarkers.set(station.id, marker);
      return marker;
    });
    this.markers.clearLayers();
    this.markers.addLayers(markers);
  }

  private createStationIcon(
    offer: FuelOffer | null,
    thresholds: { low: number; high: number },
    showPrice: boolean,
    cheapest = false,
  ): L.DivIcon {
    const tone = !offer
      ? 'none'
      : offer.status === 'suspicious_low'
        ? 'outlier'
        : offer.price <= thresholds.low
          ? 'low'
          : offer.price >= thresholds.high
            ? 'high'
            : 'mid';
    const priceText = showPrice && offer ? formatPrice(offer.price) : '';
    const markerWidth = Math.max(62, priceText.length * 8 + 18);
    return L.divIcon({
      className: `station-pin station-pin--${tone}${priceText ? ' station-pin--priced' : ''}${priceText && cheapest ? ' station-pin--cheapest' : ''}`,
      html: `<span>${priceText}</span>`,
      iconSize: priceText ? [markerWidth, 28] : [14, 14],
      iconAnchor: priceText ? [markerWidth / 2, 14] : [7, 7],
      popupAnchor: [0, priceText ? -14 : -7],
    });
  }

  private updateMarkerLabels(): void {
    const thresholds = this.priceThresholds();
    const showPrice = this.map.getZoom() >= labelZoom;
    for (const station of this.stations) {
      const marker = this.stationMarkers.get(station.id);
      if (marker) marker.setIcon(this.createStationIcon(this.selectedOffer(station), thresholds, showPrice, station.id === this.cheapestId));
    }
  }

  // Marks the lowest reported price among the stations inside the current view, so the best option stands out while browsing.
  private updateCheapestInView(): void {
    let nextId: string | null = null;
    if (this.map.getZoom() >= labelZoom) {
      const bounds = this.map.getBounds();
      let best = Infinity;
      for (const station of this.stations) {
        const offer = this.selectedOffer(station);
        if (!offer || offer.status === 'suspicious_low' || offer.price >= best) continue;
        if (!bounds.contains([station.latitude, station.longitude])) continue;
        // Only pins that are drawn on their own count; one hidden inside a cluster could not be seen.
        const marker = this.stationMarkers.get(station.id);
        if (!marker || this.markers.getVisibleParent(marker) !== marker) continue;
        best = offer.price;
        nextId = station.id;
      }
    }
    if (nextId === this.cheapestId) return;
    const previousId = this.cheapestId;
    this.cheapestId = nextId;
    const thresholds = this.priceThresholds();
    for (const id of [previousId, nextId]) {
      const station = id ? this.stations.find((candidate) => candidate.id === id) : undefined;
      const marker = id ? this.stationMarkers.get(id) : undefined;
      if (!station || !marker) continue;
      marker.setIcon(this.createStationIcon(this.selectedOffer(station), thresholds, this.map.getZoom() >= labelZoom, id === this.cheapestId));
      marker.setZIndexOffset(id === this.cheapestId ? 800 : 0);
    }
  }

  private createPopup(station: Station, offer: FuelOffer | null): HTMLElement {
    const container = document.createElement('div');
    container.className = 'station-popup';
    const heading = document.createElement('div');
    heading.className = 'station-popup-heading';
    const brand = document.createElement('strong');
    brand.className = 'station-popup-brand';
    brand.textContent = station.brand;
    heading.append(brand);
    container.append(heading);
    const address = textLine('station-popup-address', `${station.address}, ${station.commune}`);
    address.setAttribute('aria-label', 'Dirección');
    container.append(address);
    if (offer) {
      const details = document.createElement('div');
      details.className = 'station-popup-details';
      const fuel = document.createElement('span');
      fuel.className = 'station-popup-fuel';
      fuel.textContent = fuelLabels[this.selectedFuel];
      const service = document.createElement('span');
      service.className = 'station-popup-service';
      service.textContent = offer.service === 'asistido' ? 'Atendido' : 'Autoservicio';
      details.append(fuel, service);
      container.append(details);

      const priceRow = document.createElement('div');
      priceRow.className = 'station-popup-price-row';
      const price = document.createElement('strong');
      price.className = 'station-popup-price';
      price.textContent = formatPrice(offer.price);
      const unit = document.createElement('span');
      unit.className = 'station-popup-unit';
      unit.textContent = 'por litro';
      priceRow.append(price, unit);
      container.append(priceRow);
      if (offer.status === 'suspicious_low') container.append(textLine('station-popup-warning', 'La fuente marca este precio como inusual.'));
      container.append(textLine('station-popup-reported', offer.reportedAt ? `Precio informado ${dateTimeFormatter.format(offer.reportedAt)}` : 'Fecha del precio no informada'));
    } else {
      container.append(textLine('station-popup-unavailable', `No hay precio informado para ${fuelLabels[this.selectedFuel]}.`));
    }
    const directions = document.createElement('a');
    directions.className = 'station-popup-directions';
    directions.href = `https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}`;
    directions.target = '_blank';
    directions.rel = 'noreferrer';
    directions.setAttribute('aria-label', `Cómo llegar a ${station.brand} en Google Maps`);
    const directionsLabel = document.createElement('span');
    directionsLabel.textContent = 'Cómo llegar';
    directions.append(directionsLabel);
    container.append(directions);
    return container;
  }

  private async requestLocation(): Promise<void> {
    if (!navigator.geolocation) {
      this.showStatus('Este navegador no permite compartir la ubicación, pero puedes explorar todas las bencineras en el mapa.');
      return;
    }
    this.locationButton.disabled = true;
    this.locationButton.textContent = 'Buscando ubicación…';
    this.showStatus('Esperando permiso de ubicación…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.userLocation = L.latLng(position.coords.latitude, position.coords.longitude);
        this.locationLayer.clearLayers();
        const car = document.createElement('span');
        car.className = 'user-location-car';
        car.setAttribute('aria-hidden', 'true');
        car.textContent = '🚗';
        twemoji.parse(car, {
          base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/',
          className: 'user-location-car-image',
          ext: '.svg',
          folder: 'svg',
        });
        car.querySelector<HTMLImageElement>('.user-location-car-image')?.addEventListener('error', () => {
          car.textContent = '🚗';
        });
        const icon = L.divIcon({
          className: 'user-location-pin',
          html: car,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
        L.marker(this.userLocation, { icon, keyboard: false, title: 'Tu ubicación', zIndexOffset: 1000 }).addTo(this.locationLayer);
        L.circle(this.userLocation, { radius: position.coords.accuracy, className: 'user-location-accuracy', color: '#55b9ef', weight: 1, fillOpacity: 0.08 }).addTo(this.locationLayer);
        this.map.flyTo(this.userLocation, 11, { duration: 0.55 });
        this.statusElement.textContent = 'Tu ubicación se usa solo en este dispositivo. Las distancias son en línea recta.';
        this.statusElement.hidden = true;
        this.locationNotice = '';
        this.renderNearbyStations();
        this.setSheet('half');
        this.locationButton.disabled = false;
        this.locationButton.innerHTML = '<span aria-hidden="true">◎</span> Actualizar ubicación';
      },
      () => {
        // The ranking of the visible area keeps working, so the notice only explains why the nearby one did not appear.
        this.statusElement.hidden = true;
        this.locationNotice = 'No pudimos ver tu ubicación. Revisa el permiso del navegador o sigue con las más baratas de esta zona.';
        this.renderNearbyStations();
        if (this.sheetState === 'collapsed') this.setSheet('half');
        this.locationButton.disabled = false;
        this.locationButton.innerHTML = '<span aria-hidden="true">◎</span> Usar mi ubicación';
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5 * 60 * 1000 },
    );
  }

  private renderNearbyStations(): void {
    const origin = this.userLocation;
    const rankable = (station: Station): LocatedStation | null => {
      const offer = this.selectedOffer(station);
      return offer ? { station, offer, distanceKm: origin ? distanceBetween(origin, station.latitude, station.longitude) : null } : null;
    };
    const byPrice = (left: LocatedStation, right: LocatedStation): number =>
      Number(left.offer.status === 'suspicious_low') - Number(right.offer.status === 'suspicious_low') || left.offer.price - right.offer.price;
    let ranked: LocatedStation[] = [];
    if (origin) {
      this.nearbyTitle.textContent = 'Más baratas cerca de ti';
      this.nearbyCount.textContent = '';
      ranked = this.stations.flatMap((station) => rankable(station) ?? []).sort((left, right) => (left.distanceKm ?? 0) - (right.distanceKm ?? 0)).slice(0, 7).sort(byPrice);
    } else {
      this.nearbyTitle.textContent = 'Más baratas en esta zona';
      this.renderLocateShortcut();
      if (this.map.getZoom() >= zoneZoom) {
        const bounds = this.map.getBounds();
        ranked = this.stations.flatMap((station) => bounds.contains([station.latitude, station.longitude]) ? rankable(station) ?? [] : []).sort(byPrice).slice(0, 7);
      }
    }
    const notice = this.locationNotice ? `<p class="nearby-notice">${this.escapeHtml(this.locationNotice)}</p>` : '';
    if (ranked.length === 0) {
      this.nearbyPinned.innerHTML = '';
      const message = origin
        ? `Ninguna bencinera cercana informa precio de ${fuelLabels[this.selectedFuel]}.`
        : this.map.getZoom() < zoneZoom
          ? 'Acerca el mapa a tu zona para ver cuáles son las bencineras más baratas de ahí, o usa tu ubicación.'
          : `No hay bencineras con precio de ${fuelLabels[this.selectedFuel]} en esta zona.`;
      this.nearbyList.innerHTML = `${notice}<p class="nearby-empty">${message}</p>`;
      return;
    }
    if (!ranked.some(({ station }) => station.id === this.selectedStationId)) this.selectedStationId = null;
    // The cheapest station stays pinned above the scrolling list, so it is visible even when the mobile sheet is collapsed.
    const [first, ...others] = ranked;
    const pinned = first && first.offer.status !== 'suspicious_low' ? first : null;
    this.nearbyPinned.innerHTML = pinned ? this.nearbyCard(pinned, true) : '';
    this.nearbyList.innerHTML = notice + (pinned ? others : ranked).map((item) => this.nearbyCard(item, false)).join('');
    this.panelElement.querySelectorAll<HTMLButtonElement>('.nearby-station-select').forEach((button) => {
      button.addEventListener('click', () => this.focusStation(button.dataset.stationId));
    });
  }

  // Before sharing a location the ranking still works for the visible area, and this shortcut offers the nearby one.
  private renderLocateShortcut(): void {
    this.nearbyCount.innerHTML = '<button class="sheet-locate" type="button">Usar mi ubicación</button>';
    this.nearbyCount.querySelector<HTMLButtonElement>('.sheet-locate')?.addEventListener('click', () => this.locationButton.click());
  }

  private nearbyCard({ station, offer, distanceKm }: LocatedStation, cheapest: boolean): string {
    const note = [cheapest ? 'Menor precio' : '', offer.service === 'asistido' ? 'atendido' : offer.service, offer.status === 'suspicious_low' ? 'precio inusual' : ''].filter(Boolean).join(', ');
    return `<article class="nearby-station${cheapest ? ' nearby-station--cheapest' : ''}"><button class="nearby-station-select" type="button" data-station-id="${this.escapeHtml(station.id)}" aria-pressed="${station.id === this.selectedStationId}" aria-label="Ver ${this.escapeHtml(station.brand)} en el mapa por ${formatPrice(offer.price)} por litro"><span class="nearby-station-top"><strong>${this.escapeHtml(station.brand)}</strong>${distanceKm === null ? '' : `<span>${distanceKm.toFixed(1).replace('.', ',')} km</span>`}</span><span class="nearby-station-address">${this.escapeHtml(station.address)}, ${this.escapeHtml(station.commune)}</span><span class="nearby-station-bottom"><strong>${formatPrice(offer.price)}/L</strong><span>${note}</span></span></button><a href="https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}" target="_blank" rel="noreferrer">Cómo llegar</a></article>`;
  }

  // On phones the nearby list is a bottom sheet over the map with three heights; elsewhere these states are ignored by CSS.
  private setSheet(state: 'collapsed' | 'half' | 'full'): void {
    this.sheetState = state;
    this.layoutElement.dataset.sheet = state;
    this.panelElement.style.height = '';
    this.panelElement.querySelector('#nearby-handle')?.setAttribute('aria-expanded', String(state === 'half' || state === 'full'));
  }

  private initSheet(): void {
    const handle = this.panelElement.querySelector<HTMLButtonElement>('#nearby-handle');
    this.setSheet('collapsed');
    if (!handle) return;
    const order: Array<'collapsed' | 'half' | 'full'> = ['collapsed', 'half', 'full'];
    const heights = (): Record<'collapsed' | 'half' | 'full', number> => ({
      collapsed: 226,
      half: this.layoutElement.clientHeight * 0.52,
      full: this.layoutElement.clientHeight * 0.88,
    });
    let drag: { startY: number; startHeight: number; moved: boolean } | null = null;
    let suppressClick = false;
    handle.addEventListener('pointerdown', (event) => {
      drag = { startY: event.clientY, startHeight: this.panelElement.offsetHeight, moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const delta = drag.startY - event.clientY;
      if (!drag.moved && Math.abs(delta) < 6) return;
      drag.moved = true;
      this.panelElement.classList.add('is-dragging');
      const limits = heights();
      this.panelElement.style.height = `${Math.min(limits.full, Math.max(limits.collapsed, drag.startHeight + delta))}px`;
    });
    const finish = (): void => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      this.panelElement.classList.remove('is-dragging');
      if (!moved) return;
      suppressClick = true;
      const current = this.panelElement.offsetHeight;
      const limits = heights();
      const nearest = order.reduce((best, state) => Math.abs(limits[state] - current) < Math.abs(limits[best] - current) ? state : best, 'half' as 'collapsed' | 'half' | 'full');
      this.setSheet(nearest);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const index = order.indexOf(this.sheetState);
      this.setSheet(order[(index + 1) % order.length] ?? 'half');
    });
  }

  private focusStation(stationId: string | undefined): void {
    if (!stationId) return;
    this.selectedStationId = stationId;
    this.panelElement.querySelectorAll<HTMLButtonElement>('.nearby-station-select').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.stationId === stationId));
    });
    this.pendingStationId = stationId;
    this.suppressRankingUntil = Date.now() + 2500;
    if (window.matchMedia('(max-width: 760px)').matches) this.setSheet('collapsed');
    if (this.markersReady) this.focusPendingStation();
  }

  private focusPendingStation(): void {
    const stationId = this.pendingStationId;
    if (!stationId || !this.markersReady) return;
    const marker = this.stationMarkers.get(stationId);
    if (!marker) return;
    this.pendingStationId = null;
    if (window.matchMedia('(max-width: 760px)').matches) {
      this.map.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    this.map.once('moveend', () => this.markers.zoomToShowLayer(marker, () => marker.openPopup()));
    this.map.flyTo(marker.getLatLng(), Math.max(this.map.getZoom(), 15), { duration: 0.45 });
  }

  private renderNearbyEmpty(message: string): void {
    this.nearbyList.innerHTML = '';
    const empty = document.createElement('p');
    empty.className = 'nearby-empty';
    empty.textContent = message;
    this.nearbyList.append(empty);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
  }
}
