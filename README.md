# Alzas Combustible Chile

Alzas Combustible Chile helps people compare fuel prices in Chile, follow price changes over time, and read the news behind those changes.

## What you can do

- **Track fuel prices:** Explore the historical price per liter for gasoline 93, 95, 97, and diesel. Choose a one, three, six, or twelve month period, and inspect the date and value for each observation.
- **Find a cheaper nearby station:** Browse geolocated stations across Chile, then choose a fuel type to compare station-reported prices. After you share your location, the seven closest stations with a reported price are listed from lowest to highest for the selected fuel.
- **Open a station on the map:** Select a station in the nearby list to center the map on it and open its price details. Use **Get directions** to open its location in Google Maps. Prices flagged by the source as unusual are identified separately.
- **Keep up with fuel news:** Read recent Chilean stories from Cooperativa and BioBioChile, with the source, publication date, short summary, and a link to the original article. Images appear when the source provides one.

## Data and freshness

The historical chart uses the independently maintained [BencinasChile price table](https://bencinaschile.cl/historial-precio-bencina/), which publishes daily averages based on prices stations report to CNE's Bencina en Línea. The series is an independent source-reported average, not an official CNE weighted national average. If the source has no observation for part of a selected period, the chart marks that gap instead of inventing values.

The station map uses the current catalogue from [Bencina.cl](https://bencina.cl/fuentes-y-metodologia/), an independent mirror that says it reads station locations and reported prices from the CNE Bencina en Línea API and refreshes its source hourly. Station prices are reported by each station and can differ from the historical chart's national average.

News comes from [Cooperativa's RSS feed](https://www.cooperativa.cl/noticias/site/tax/port/all/rss_3___1.xml) and BioBioChile's [fuel news listing](https://www.biobiochile.cl/lista/tag/combustibles). While the page is open, it checks the chart, station catalogue, and news sources every five minutes, and checks again when the page becomes active or reconnects. New information appears when it is published by the sources; this does not imply a guaranteed update schedule for those sources.

Your location is requested only when you press **Use my location**. The nearby-station distances are calculated in your browser and are not stored by this app.
The map's car emoji artwork is provided by [Twemoji](https://github.com/jdecked/twemoji) under the CC BY 4.0 license.

## Run locally

```sh
npm install
npm run dev
```

The Vite development and preview servers proxy historical prices, the station catalogue, and news requests. Vercel rewrites the corresponding `/api/*` data routes to their sources to avoid browser CORS restrictions without serverless functions. Map tiles load directly from OpenStreetMap.

## Contributing

Bug fixes and features use short-lived branches and pull requests into `main`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit, review, and deployment workflow.

## Technology

Strict TypeScript, Vite, semantic HTML, custom SVG for the price chart, Leaflet for the station map, and responsive CSS.
