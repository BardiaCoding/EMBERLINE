import type { MapOptions } from 'maplibre-gl'

/**
 * Open basemap, no access token.
 *
 * Choice: raster tiles from the OpenStreetMap Foundation tile server in an inline style.
 * Reason: needs no key, no account and no extra dependency, and shows roads and place names
 * that help users place a drawn area.
 * Attribution: "© OpenStreetMap contributors" (ODbL), shown in the map's attribution control
 * as the OSM licence requires. Tile usage policy: https://operations.osmfoundation.org/policies/tiles/
 * The policy allows light use only. DEFAULT (confirm): before heavy public traffic, switch to
 * a hosted provider with a free tier, or self-hosted tiles. Change `BASEMAP_TILES` only.
 */
export const BASEMAP_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png']

export const BASEMAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

type StyleOption = NonNullable<MapOptions['style']>

export const BASEMAP_STYLE: Exclude<StyleOption, string> = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: BASEMAP_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: BASEMAP_ATTRIBUTION,
    },
  },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
}
