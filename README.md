# Alzas Combustible Chile

A focused Chilean fuel prices and news page. Its two sections are an interactive historical price chart and a live list of relevant news.

## Features

- Historical daily prices per liter for gasoline 93, 95, 97, and diesel.
- Fuel selectors and 1, 3, 6, and 12 month periods.
- Hoverable chart points showing the observation date and price.
- Period change in CLP per liter and percent, calculated from the first and last available observations in the selected range.
- An explicit coverage note when the source does not cover the full selected period; missing dates are never filled with synthetic values.
- Recent news aggregated from Cooperativa and BioBioChile public RSS feeds, filtered for fuel and energy-related topics, deduplicated, and linked to the original articles. Article images are shown when a feed supplies one.
- Loading and error states for both sources.

## Data and sources

The CNE's Energía Abierta catalog describes a historical Bencina en Línea dataset from 2012 onward, but its download link currently redirects to a SharePoint location that returns HTTP 401. The app therefore uses the independently maintained [BencinasChile historical price table](https://bencinaschile.cl/historial-precio-bencina/), which publishes daily averages built from prices that stations report to the CNE's Bencina en Línea. Its method and coverage are described on its [sources and methodology page](https://bencinaschile.cl/fuentes-y-metodologia/).

The displayed series is a source-reported average across stations with valid prices, not an official CNE weighted national average. The public table currently contains daily data back to August 2026; for 6- and 12-month views, the earlier uncovered part of the selected period is visibly marked as unavailable. The app does not fill missing dates with synthetic values.

News is fetched from [Cooperativa's RSS feed](https://www.cooperativa.cl/noticias/site/tax/port/all/rss_3___1.xml) and the [BioBioChile RSS feed](https://feeds.feedburner.com/radiobiobio/NNeJ). The page displays the article source, publication date, a short excerpt, an image when supplied, and a direct link to the original article. Duplicate canonical URLs and exact normalized titles are removed before display.

## Run locally

```sh
npm install
npm run dev
```

The Vite dev and preview servers proxy the history and RSS source requests to avoid browser CORS restrictions. A static production host must provide equivalent `/api/fuel-history`, `/api/news-feed`, and `/api/news-feed-biobio` proxy endpoints.

## Technology

Strict TypeScript, Vite, semantic HTML, and custom SVG/CSS. The chart uses native SVG and adds no charting dependency.
