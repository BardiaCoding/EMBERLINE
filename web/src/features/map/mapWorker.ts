import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

/**
 * Points MapLibre at the worker file that Vite emits as its own asset. Without this the bundled
 * MapLibre looks for `maplibre-gl-worker.mjs` next to the app chunk, gets a 404 (or the SPA
 * index page) and tile parsing and GeoJSON layers never render. Imported once from `main.tsx`.
 */
setWorkerUrl(workerUrl)
