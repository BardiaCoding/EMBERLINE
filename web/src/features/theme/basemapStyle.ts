import { BASEMAP_STYLE } from '@/features/map/basemap'

/**
 * Basemap style for a theme. Light is the plain OSM raster. Dark darkens the same tiles with
 * raster paint properties (no second tile provider, no token). Pass the result to `map.setStyle`
 * when `useChartColours`' theme (`isDarkTheme`) changes.
 */
export function basemapStyleFor(dark: boolean): typeof BASEMAP_STYLE {
  if (!dark) return BASEMAP_STYLE
  return {
    ...BASEMAP_STYLE,
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: {
          'raster-brightness-max': 0.45,
          'raster-brightness-min': 0,
          'raster-contrast': 0.1,
          'raster-saturation': -0.4,
        },
      },
    ],
  }
}
