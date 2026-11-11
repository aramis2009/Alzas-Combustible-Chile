# Alzas Combustible Chile

A lightweight dashboard that helps people in Chile understand fuel prices, price changes, historical trends, and the news behind them.

## What the website does

- Presents national reference prices for gasoline 93, 95, 97, and diesel when a live source is reachable.
- Links users to official price and energy information from the National Energy Commission (CNE) and ENAP.
- Explains data freshness and source limitations instead of filling gaps with made-up figures.
- Provides a historical chart area prepared for verified time-series data.

## Data status

The current price panel attempts to read the public Bencina en Línea zonal export. Availability and browser access may vary. If the feed cannot be read or its format is unsupported, prices remain unavailable and users are sent to Bencina en Línea.

The CNE's consumer fuel price series in its hydrocarbon statistics is marked as discontinued since August 2008. For that reason, this MVP does not draw a fabricated historical chart or invent percentage changes. The period controls are a visual placeholder until a current, traceable series is integrated.

The news area currently links to official publications and data portals, rather than claiming to be a live news aggregator. Each card opens its original source.

## Sources

- [CNE: Hydrocarbon statistics](https://www.cne.cl/estadisticas/hidrocarburo/)
- [CNE: Energía Abierta](https://energiaabierta.cne.cl/categorias-estadistica/hidrocarburos)
- [Bencina en Línea](https://www.bencinaenlinea.cl/)
- [ENAP: Weekly price reports](https://www.enap.cl/informe-semanal-de-precios?page=1&year=2026)

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`.

## Technology

TypeScript in strict mode, Vite, and plain CSS. No charting or UI library is required for this MVP.
