import * as L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

export type FuelId = '93' | '95' | '97' | 'diesel';
type FuelOffer = { fuel: FuelId; service: 'asistido' | 'autoservicio'; price: number; reportedAt: Date | null; status: 'ok' | 'high' | 'suspicious_low' };
type Station = { id: string; brand: string; address: string; commune: string; latitude: number; longitude: number; offers: FuelOffer[] };
type ParsedCatalogue = { stations: Station[]; checkedAt: Date };
type LocatedStation = { station: Station; offer: FuelOffer; distanceKm: number };

const fuelLabels: Record<FuelId, string> = { '93': 'Gasolina 93', '95': 'Gasolina 95', '97': 'Gasolina 97', diesel: 'Diésel' };
const fuelIndexes: FuelId[] = ['93', '95', '97', 'diesel'];
const statusNames: FuelOffer['status'][] = ['ok', 'high', 'suspicious_low'];
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
  private checkedAt: Date | null = null;
  private snapshot = '';
  private lastLabelZoom = false;
  private isLoading = false;
  private hasFittedBounds = false;

  constructor(initialFuel: FuelId, onFuelChange: (fuel: FuelId) => void) {
    const mapElement = document.querySelector<HTMLDivElement>('#station-map');
    const summaryElement = document.querySelector<HTMLElement>('#station-summary');
    const statusElement = document.querySelector<HTMLElement>('#station-map-status');
    const nearbyList = document.querySelector<HTMLDivElement>('#nearby-list');
    const nearbyCount = document.querySelector<HTMLElement>('#nearby-count');
    const locationButton = document.querySelector<HTMLButtonElement>('#station-locate');
    if (!mapElement || !summaryElement || !statusElement || !nearbyList || !nearbyCount || !locationButton) {
      throw new Error('The station map container is incomplete');
    }

    this.summaryElement = summaryElement;
    this.statusElement = statusElement;
    this.nearbyList = nearbyList;
    this.nearbyCount = nearbyCount;
    this.locationButton = locationButton;
    this.selectedFuel = initialFuel;
    this.fuelChange = onFuelChange;
    this.map = L.map(mapElement, { zoomControl: false, minZoom: 3, maxZoom: 18 }).setView([-35.7, -71.2], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(this.map);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.markers = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: (zoom) => zoom < 9 ? 46 : 30,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => L.divIcon({
        className: 'station-cluster-icon',
        html: `<span>${numberFormatter.format(cluster.getChildCount())}</span>`,
        iconSize: [36, 36],
      }),
    }).addTo(this.map);
    this.locationLayer.addTo(this.map);
    this.lastLabelZoom = this.map.getZoom() >= 13;
    this.map.on('zoomend', () => {
      const shouldShowPrices = this.map.getZoom() >= 13;
      if (shouldShowPrices !== this.lastLabelZoom) {
        this.lastLabelZoom = shouldShowPrices;
        this.renderMarkers();
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
          this.map.fitBounds(chileBounds, { padding: [18, 18], maxZoom: 4.5 });
          this.hasFittedBounds = true;
        }
      } else {
        this.updateSummary();
      }
      this.statusElement.textContent = this.userLocation
        ? 'Ubicación activa solo en este dispositivo. Ordena los precios de las estaciones cercanas.'
        : 'El mapa muestra estaciones de todo Chile. Tu ubicación se usará solo si la solicitas.';
      this.statusElement.hidden = true;
    } catch {
      this.summaryElement.textContent = 'Datos de estaciones temporalmente no disponibles';
      this.statusElement.textContent = 'No pudimos cargar los precios por estación desde la fuente. Vuelve a intentarlo más tarde.';
      this.statusElement.hidden = false;
      if (this.stations.length === 0) this.renderNearbyEmpty('No hay datos de estaciones disponibles en este momento.');
    } finally {
      this.locationButton.disabled = false;
      this.isLoading = false;
    }
  }

  private isFuelId(value: string | undefined): value is FuelId {
    return value === '93' || value === '95' || value === '97' || value === 'diesel';
  }

  private selectedOffer(station: Station): FuelOffer | null {
    return bestOffer(station, this.selectedFuel);
  }

  private renderStations(): void {
    this.renderMarkers();
    this.renderNearbyStations();
    this.updateSummary();
  }

  private updateSummary(): void {
    const stationsWithPrice = this.stations.filter((station) => this.selectedOffer(station) !== null).length;
    const freshness = this.checkedAt ? `Datos consultados ${dateTimeFormatter.format(this.checkedAt)}` : 'Datos de CNE';
    this.summaryElement.textContent = `${numberFormatter.format(this.stations.length)} estaciones ubicadas · ${numberFormatter.format(stationsWithPrice)} con ${fuelLabels[this.selectedFuel]} · ${freshness}`;
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
    const thresholds = this.priceThresholds();
    const showPrice = this.map.getZoom() >= 13;
    const markers = this.stations.map((station) => {
      const offer = this.selectedOffer(station);
      const tone = offer?.status === 'suspicious_low'
        ? 'outlier'
        : offer && offer.price <= thresholds.low
          ? 'low'
          : offer && offer.price >= thresholds.high
            ? 'high'
            : 'mid';
      const priceText = showPrice && offer ? formatPrice(offer.price).replace('$', '') : '';
      const icon = L.divIcon({
        className: `station-pin station-pin--${tone}`,
        html: `<span>${priceText}</span>`,
        iconSize: showPrice && offer ? [54, 24] : [14, 14],
        iconAnchor: showPrice && offer ? [27, 12] : [7, 7],
        popupAnchor: [0, showPrice && offer ? -12 : -7],
      });
      const marker = L.marker([station.latitude, station.longitude], { icon });
      marker.bindPopup(this.createPopup(station, offer), { minWidth: 220, maxWidth: 280 });
      return marker;
    });
    this.markers.clearLayers();
    this.markers.addLayers(markers);
  }

  private createPopup(station: Station, offer: FuelOffer | null): HTMLElement {
    const container = document.createElement('div');
    container.className = 'station-popup';
    const brand = document.createElement('strong');
    brand.textContent = station.brand;
    container.append(brand);
    container.append(textLine('station-popup-address', `${station.address}, ${station.commune}`));
    if (offer) {
      const price = document.createElement('strong');
      price.className = 'station-popup-price';
      price.textContent = `${formatPrice(offer.price)}/L`;
      container.append(price);
      container.append(textLine('station-popup-detail', `${fuelLabels[this.selectedFuel]} · ${offer.service}`));
      if (offer.status === 'suspicious_low') container.append(textLine('station-popup-warning', 'La fuente marca este precio como atípico.'));
      container.append(textLine('station-popup-detail', offer.reportedAt ? `Informado ${dateTimeFormatter.format(offer.reportedAt)}` : 'Sin fecha informada'));
    } else {
      container.append(textLine('station-popup-detail', `Sin precio informado para ${fuelLabels[this.selectedFuel]}.`));
    }
    const directions = document.createElement('a');
    directions.href = `https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}`;
    directions.target = '_blank';
    directions.rel = 'noreferrer';
    directions.textContent = 'Cómo llegar ↗';
    container.append(directions);
    return container;
  }

  private async requestLocation(): Promise<void> {
    if (!navigator.geolocation) {
      this.statusElement.textContent = 'Este navegador no permite compartir la ubicación. Puedes explorar todas las estaciones en el mapa.';
      this.statusElement.hidden = false;
      return;
    }
    this.locationButton.disabled = true;
    this.locationButton.textContent = 'Buscando ubicación…';
    this.statusElement.textContent = 'Esperando permiso de ubicación…';
    this.statusElement.hidden = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.userLocation = L.latLng(position.coords.latitude, position.coords.longitude);
        this.locationLayer.clearLayers();
        const icon = L.divIcon({ className: 'user-location-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
        L.marker(this.userLocation, { icon, keyboard: false, title: 'Tu ubicación' }).addTo(this.locationLayer);
        L.circle(this.userLocation, { radius: position.coords.accuracy, className: 'user-location-accuracy', weight: 1, fillOpacity: 0.06 }).addTo(this.locationLayer);
        this.map.flyTo(this.userLocation, 11, { duration: 0.55 });
        this.statusElement.textContent = 'Ubicación activa solo en este dispositivo. Las distancias son en línea recta.';
        this.statusElement.hidden = true;
        this.renderNearbyStations();
        this.locationButton.disabled = false;
        this.locationButton.innerHTML = '<span aria-hidden="true">◎</span> Actualizar ubicación';
      },
      () => {
        this.statusElement.textContent = 'No pudimos obtener tu ubicación. Revisa el permiso del navegador o explora el mapa de Chile.';
        this.statusElement.hidden = false;
        this.locationButton.disabled = false;
        this.locationButton.innerHTML = '<span aria-hidden="true">◎</span> Usar mi ubicación';
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5 * 60 * 1000 },
    );
  }

  private renderNearbyStations(): void {
    if (!this.userLocation) {
      this.nearbyCount.textContent = '';
      this.renderNearbyEmpty('Activa tu ubicación para ver y comparar las estaciones más cercanas.');
      return;
    }
    const nearest: LocatedStation[] = this.stations.flatMap((station) => {
      const offer = this.selectedOffer(station);
      if (!offer) return [];
      return [{ station, offer, distanceKm: distanceBetween(this.userLocation!, station.latitude, station.longitude) }];
    }).sort((left, right) => left.distanceKm - right.distanceKm).slice(0, 7);
    this.nearbyCount.textContent = nearest.length ? `${nearest.length} estaciones` : '';
    if (nearest.length === 0) {
      this.renderNearbyEmpty(`No hay precios informados de ${fuelLabels[this.selectedFuel]} cerca de tu ubicación.`);
      return;
    }
    this.nearbyList.innerHTML = nearest.map(({ station, offer, distanceKm }) => `<article class="nearby-station"><div class="nearby-station-top"><strong>${this.escapeHtml(station.brand)}</strong><span>${distanceKm.toFixed(1).replace('.', ',')} km</span></div><p>${this.escapeHtml(station.address)}, ${this.escapeHtml(station.commune)}</p><div class="nearby-station-bottom"><strong>${formatPrice(offer.price)}/L</strong><span>${offer.service}${offer.status === 'suspicious_low' ? ' · atípico' : ''}</span></div><a href="https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}" target="_blank" rel="noreferrer">Cómo llegar ↗</a></article>`).join('');
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
