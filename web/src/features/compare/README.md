# Comparison Mode Feature

Implements side-by-side comparison for the Harmonized Fire Calendar (Requirements 19.1, 19.4, 19.5).

## Components

### CompareControls

Radio-based UI for selecting comparison mode:

- **None**: Single view (default)
- **Compare Areas**: Two different spatial areas side by side
- **Compare Periods**: Two different time ranges for the same area

Area comparison includes a per-area normalization toggle (counts per 1000 km²).

### CompareView

Two-panel layout showing calendars side by side with:

- Unified colour scale computed from both datasets
- Single shared legend
- Optional per-area normalization
- Comparison summary statistics

## Utilities

### binning.unified.ts

Computes unified binning edges from two datasets:

- **Counts view**: Quantile edges from union of non-zero values
- **Anomaly view**: Fixed edges (always the same)
- **Diff view**: Symmetric bins from 95th percentile of all differences

### normalize.ts

Per-area normalization for fair comparison of differently sized areas:

- Normalizes counts to per 1000 km² using geodesic area
- Keeps raw counts unchanged
- Adjusts baselines and anomalies proportionally

## URL State

Comparison state is stored in URL parameters:

- `cmp`: mode (none | area | period)
- `a2`: second area geometry code or share id
- `pa`: per-area flag (0 | 1)
- `from2`, `to2`: second period dates

## Testing

- Unit tests: `CompareControls.test.tsx`
- Unit tests: `normalize.test.ts`, `binning.unified.test.ts`
- Property tests: `binning.unified.property.test.ts`
  - Validates that unified bins contain data from both panels
  - Checks that edges are monotonic
  - Verifies anomaly view always uses fixed edges
  - Ensures stable results for same inputs

## Usage

```tsx
import { CompareControls, CompareView } from '@/features/compare'

// In a control panel
;<CompareControls
  compare={urlState.compare}
  primaryRange={dateRange}
  onCompareChange={(newCompare) => updateUrlState({ compare: newCompare })}
  renderAreaSelector={renderAreaSelector}
  renderDateRangeSelector={renderDateRangeSelector}
/>

// In the results view
{
  compare.mode !== 'none' ? (
    <CompareView
      result1={primaryResult}
      result2={secondaryResult}
      compare={compare}
      view={calendarView}
      range1={primaryRange}
      range2={secondaryRange}
      area1_km2={primaryArea}
      area2_km2={secondaryArea}
      label1="Area 1"
      label2="Area 2"
    />
  ) : (
    <SingleCalendarView result={primaryResult} />
  )
}
```

## Design Notes

- For P1, unified binning is applied to pre-built models. Full reclassification with unified edges is marked for future enhancement.
- Area normalization uses geodesic calculation for accuracy across different latitudes.
- Comparison mode supports both area and period comparison, but not both simultaneously.
- The unified scale ensures visual comparability between panels.
