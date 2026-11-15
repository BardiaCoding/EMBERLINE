/**
 * HAND-WRITTEN PLACEHOLDER (tasks 11.1 and 11.10).
 *
 * Written by hand from `src/hotspots/api/schemas.py` and `routes/health.py`, in the same
 * shape openapi-typescript produces (`paths` and `components.schemas`). Fields that have a
 * default in pydantic are required here, as in the serialization-mode OpenAPI schema.
 * Regenerate it with `npm run gen:api` while the API is running; the generated file replaces
 * this one. Keep the schema names below, because `lib/api.ts` imports them.
 *
 * Units: counts are cell-days (MODIS-equivalent). Days, months and years use fixed UTC-8.
 * Coordinates are EPSG:4326 (lon, lat).
 */

export interface components {
  schemas: {
    /** One field-level validation failure inside the error envelope. */
    ErrorField: {
      field: string
      reason: string
    }
    ErrorBody: {
      code: string
      message: string
      fields?: components['schemas']['ErrorField'][]
      request_id?: string | null
    }
    /** Error envelope used for every non-2xx response. */
    ErrorOut: {
      error: components['schemas']['ErrorBody']
    }
    Geometry: {
      type: 'Polygon' | 'MultiPolygon'
      coordinates: unknown[]
    }
    ExampleArea: {
      name: string
      description: string
      geometry: components['schemas']['Geometry']
    }
    /** Rectangle in EPSG:4326 degrees. Ordering and ranges are checked by the route. */
    Bbox: {
      west: number
      south: number
      east: number
      north: number
    }
    /** Circle in EPSG:4326 degrees and km. Ranges are checked by the selection module. */
    CircleIn: {
      lat: number
      lon: number
      radius_km: number
    }
    /**
     * Body of `POST /api/v1/selection/normalize`: exactly one of `geometry`, `bbox`, `circle`
     * or `geojson` (the content of an uploaded GeoJSON file).
     */
    NormalizeIn: {
      geometry?: components['schemas']['Geometry'] | null
      bbox?: components['schemas']['Bbox'] | null
      circle?: components['schemas']['CircleIn'] | null
      geojson?: { [key: string]: unknown } | null
    }
    /** Selection after validation and clipping to the region extent. */
    NormalizeOut: {
      /** Clipped polygon, coordinates rounded to 6 decimals (EPSG:4326). */
      geometry: components['schemas']['Geometry']
      clipped: boolean
      /** Share (0 to 100, one decimal) of the submitted area removed by clipping. */
      clipped_percent: number
      /** Cells whose centre lies inside the clipped area. */
      n_cells: number
      /** "no_cells" when the area holds no cell centre. */
      notice: string | null
      /** GeoJSON upload only: features that are not polygons and were left out. */
      ignored_features: number
    }
    /** Region extent in EPSG:4326 degrees. */
    Extent: {
      west: number
      south: number
      east: number
      north: number
    }
    MetaOut: {
      name: string
      extent: components['schemas']['Extent']
      /** "YYYY-MM" */
      record_start: string
      /** "YYYY-MM-DD" */
      first_date: string
      /** "YYYY-MM" */
      latest_month: string
      latest_month_incomplete: boolean
      /** "YYYY-MM" */
      latest_complete_month: string | null
      /** "YYYY-MM-DD", local date at fixed UTC-8 */
      latest_detection_local_date: string | null
      /** ISO 8601, true UTC */
      latest_detection_utc: string | null
      time_convention: string
      unit: string
      watch_threshold: number
      limitations: string[]
      example_areas: components['schemas']['ExampleArea'][]
      bounds_available: boolean
    }
    CalendarRequest: {
      /** null or missing = full region */
      geometry?: components['schemas']['Geometry'] | null
      /** "YYYY-MM-DD", whole months */
      start: string
      /** "YYYY-MM-DD", whole months */
      end: string
      baseline_years?: [number, number] | null
    }
    SeasonRequest: components['schemas']['CalendarRequest'] & {
      /** 1 to 12, default 1 (January) */
      season_start_month?: number
      /** year in which the season starts; null or missing = season of the latest complete month */
      season_year?: number | null
    }
    SeasonCurveOut: {
      season_year: number
      /** cumulative cell-days (MODIS-equivalent) at month-of-season 1, 2, ... */
      cumulative: number[]
      complete: boolean
    }
    SeasonEnvelopeOut: {
      month_of_season: number
      calendar_month: number
      p10: number
      median: number
      p90: number
    }
    SeasonOut: {
      season_start_month: number
      season_year: number | null
      selected: number[]
      /** "YYYY-MM", last month of the selected curve */
      through: string | null
      count: number | null
      median_cumulative: number | null
      /** null when the median is 0 or there is no envelope */
      percent_of_median: number | null
      /** null with fewer than 5 season years inside the baseline period */
      envelope: components['schemas']['SeasonEnvelopeOut'][] | null
      n_envelope_years: number
      curves: components['schemas']['SeasonCurveOut'][]
      provisional_month: string | null
      provisional_count: number | null
      reason: string | null
      available_season_years: number[]
      coverage: components['schemas']['CoverageOut']
      n_cells: number
      notice: string | null
      clipped_percent: number | null
    }
    AnomalyOut: {
      absolute: number
      /** null when the baseline median is 0 */
      percent: number | null
      /** "no typical fires in this month" when the baseline median is 0 */
      percent_text: string | null
      zscore: number | null
      /** 0 to 100, mid-rank */
      percentile_rank: number
      baseline_start_year: number
      baseline_end_year: number
      n_years: number
    }
    MonthOut: {
      year: number
      month: number
      /** cell-days, MODIS-equivalent, rounded to 1 decimal */
      harmonized: number
      raw_modis: number
      raw_viirs: number
      frp_sum_mw: number | null
      source_flag: string | null
      calib_model: string | null
      provenance: string | null
      provisional: boolean
      /** Deferred (Req 7): always null for now. */
      lower_bound?: number | null
      /** Deferred (Req 7): always null for now. */
      upper_bound?: number | null
      anomaly: components['schemas']['AnomalyOut'] | null
    }
    /** One calendar year of an area: the sum over the months of the year inside the result. */
    YearOut: {
      year: number
      harmonized: number
      raw_modis: number
      raw_viirs: number
      frp_sum_mw: number | null
      /** Months of this year inside the result (12 for a full year). */
      n_months: number | null
      provisional: boolean
      anomaly: components['schemas']['AnomalyOut'] | null
    }
    BaselineStatsOut: {
      median: number
      p10: number
      p90: number
      mean: number
      std: number | null
      n_years: number
    }
    BaselineOut: components['schemas']['BaselineStatsOut'] & {
      /** 1 to 12 */
      month: number
    }
    /** Months of the record that the result covers. */
    CoverageOut: {
      /** "YYYY-MM" */
      first_month: string | null
      /** "YYYY-MM" */
      last_month: string | null
      n_months: number
      /** "YYYY-MM-DD" */
      requested_start: string | null
      /** "YYYY-MM-DD" */
      requested_end: string | null
      /** Statistics cover the whole month when the range starts partway through it. */
      starts_mid_month: boolean
      /** Statistics cover the whole month when the range ends partway through it. */
      ends_mid_month: boolean
      /** The range starts before the record start. */
      before_record: boolean
      /** The range extends after the latest month of the grid. */
      after_latest: boolean
    }
    CalendarOut: {
      months: components['schemas']['MonthOut'][]
      years: components['schemas']['YearOut'][]
      baseline_by_month: components['schemas']['BaselineOut'][]
      baseline_year: components['schemas']['BaselineStatsOut'] | null
      coverage: components['schemas']['CoverageOut']
      n_cells: number
      /** e.g. "no_cells" */
      notice: string | null
      /** "YYYY-MM" */
      provisional_months: string[]
      /**
       * Share (0 to 100, one decimal) of the submitted area removed by clipping to the region
       * extent. 0 when the area lies inside it, null when no geometry was sent (full region).
       */
      clipped_percent: number | null
      /**
       * Geodesic area in km2 of the selection after clipping to the region extent (the full
       * region rectangle when no geometry was sent), rounded to one decimal.
       */
      area_km2: number | null
    }
    /** Totals over the months of the date range (Req 16.1). Units: cell-days. */
    StatsSummary: {
      /** Sum of the yearly totals as shown, MODIS-equivalent cell-days (Req 16.10). */
      total_harmonized: number
      /** Raw cell-days per sensor family. Two separate values, never added. */
      raw_modis: number
      raw_viirs: number
      /** FRP area total in MW, null when no FRP value exists. */
      frp_sum_mw: number | null
      n_months: number
      /** True when the range contains the provisional month. */
      includes_provisional: boolean
    }
    /** The calendar month that contains the end of the date range, against its baseline. */
    CurrentMonthOut: {
      year: number
      /** 1 to 12 */
      month: number
      harmonized: number
      provisional: boolean
      /** Null for the provisional month (no comparison) or when no baseline year exists. */
      baseline_median: number | null
      baseline_n_years: number
      anomaly: components['schemas']['AnomalyOut'] | null
    }
    /** The calendar year that contains the end of the date range, against the yearly baseline. */
    CurrentYearOut: {
      year: number
      harmonized: number
      /** Months of this year in the result (12 for a full year). */
      n_months: number
      provisional: boolean
      /** Null when the year is provisional or partial. */
      baseline_median: number | null
      baseline_n_years: number
      /** 0 to 100, among the baseline yearly totals. */
      percentile_rank: number | null
      anomaly: components['schemas']['AnomalyOut'] | null
    }
    RankedMonthOut: {
      year: number
      /** 1 to 12 */
      month: number
      harmonized: number
    }
    RankedYearOut: {
      year: number
      harmonized: number
      /** Months of this year in the query. Fewer than 12 is a partial total. */
      n_months: number | null
    }
    /** Baseline of one calendar month. Statistics are null when no baseline year exists. */
    SeasonalPointOut: {
      /** 1 to 12 */
      month: number
      median: number | null
      p10: number | null
      p90: number | null
      n_years: number
    }
    RecordRankOut: {
      /** "YYYY-MM" */
      month: string
      harmonized: number
      rank: number
      n_years: number
      percentile: number
      since_year: number
    }
    YearToDateOut: {
      season_year: number
      season_start_month: number
      month_of_season: number
      /** "YYYY-MM" */
      through: string
      count: number
      median_cumulative: number | null
      n_seasons: number
      percent_difference: number | null
      direction: 'above' | 'below' | 'equal' | null
    }
    BriefingInputsOut: {
      latest_complete: string | null
      latest_complete_harmonized: number | null
      short_record: boolean
      record_rank: components['schemas']['RecordRankOut'] | null
      year_to_date: components['schemas']['YearToDateOut'] | null
      peak_months: number[]
      baseline_all_zero: boolean
      provisional_months: string[]
    }
    /** Watch level of the latest complete month (monthly, independent of the Date_Range). */
    WatchOut: {
      level: 'Above normal' | 'Within normal range' | 'Not available' | null
      count: number | null
      median: number | null
      percentile: number | null
      period: string | null
      baseline_start: number | null
      baseline_end: number | null
      n_years: number | null
      provisional: boolean | null
      provisional_month: string | null
      provisional_count: number | null
      reason: string | null
      threshold: number | null
    }
    /** Response of `POST /api/v1/stats`: key figures and chart data for an area and range. */
    StatsOut: {
      summary: components['schemas']['StatsSummary']
      current_month: components['schemas']['CurrentMonthOut'] | null
      current_year: components['schemas']['CurrentYearOut'] | null
      top_months: components['schemas']['RankedMonthOut'][]
      top_years: components['schemas']['RankedYearOut'][]
      seasonal_profile: components['schemas']['SeasonalPointOut'][]
      briefing_inputs: components['schemas']['BriefingInputsOut']
      watch: components['schemas']['WatchOut'] | null
      coverage: components['schemas']['CoverageOut']
      n_cells: number
      notice: string | null
      /** "YYYY-MM" */
      provisional_months: string[]
      clipped_percent: number | null
    }
    /** Body of `GET /api/health`, also returned with HTTP 503 when the data are missing. */
    HealthOut: {
      status: 'ok' | 'unavailable'
      /** True when both delivered files were found and the grid loaded. */
      data_present: boolean
      /** "YYYY-MM", null when unavailable */
      latest_month: string | null
    }
    /** Body of `POST /api/v1/export/hotspots/estimate`: size of the hotspot CSV for a query. */
    HotspotEstimateOut: {
      /** Data rows the export would write (detections). */
      rows: number
      /** `rows * average bytes per row + header bytes`. Approximate. */
      approx_bytes: number
      /** True when `rows` is more than `limit`; the export then answers 422 `export_too_large`. */
      over_limit: boolean
      /** Most data rows one export may have. */
      limit: number
    }
  }
}

export interface paths {
  '/api/health': {
    get: {
      responses: {
        200: { content: { 'application/json': components['schemas']['HealthOut'] } }
        503: { content: { 'application/json': components['schemas']['HealthOut'] } }
      }
    }
  }
  '/api/v1/meta': {
    get: {
      responses: {
        200: { content: { 'application/json': components['schemas']['MetaOut'] } }
        '4XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
        '5XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
      }
    }
  }
  '/api/v1/selection/normalize': {
    post: {
      requestBody: { content: { 'application/json': components['schemas']['NormalizeIn'] } }
      responses: {
        200: { content: { 'application/json': components['schemas']['NormalizeOut'] } }
        422: { content: { 'application/json': components['schemas']['ErrorOut'] } }
        '5XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
      }
    }
  }
  '/api/v1/export/hotspots/estimate': {
    post: {
      requestBody: { content: { 'application/json': components['schemas']['CalendarRequest'] } }
      responses: {
        200: { content: { 'application/json': components['schemas']['HotspotEstimateOut'] } }
        422: { content: { 'application/json': components['schemas']['ErrorOut'] } }
        '5XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
      }
    }
  }
  '/api/v1/season': {
    post: {
      requestBody: { content: { 'application/json': components['schemas']['SeasonRequest'] } }
      responses: {
        200: { content: { 'application/json': components['schemas']['SeasonOut'] } }
        422: { content: { 'application/json': components['schemas']['ErrorOut'] } }
        '5XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
      }
    }
  }
  '/api/v1/stats': {
    post: {
      requestBody: { content: { 'application/json': components['schemas']['CalendarRequest'] } }
      responses: {
        200: { content: { 'application/json': components['schemas']['StatsOut'] } }
        422: { content: { 'application/json': components['schemas']['ErrorOut'] } }
        '5XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
      }
    }
  }
  '/api/v1/calendar': {
    post: {
      requestBody: { content: { 'application/json': components['schemas']['CalendarRequest'] } }
      responses: {
        200: { content: { 'application/json': components['schemas']['CalendarOut'] } }
        422: { content: { 'application/json': components['schemas']['ErrorOut'] } }
        '5XX': { content: { 'application/json': components['schemas']['ErrorOut'] } }
      }
    }
  }
}
