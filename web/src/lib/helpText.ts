import helpTextJson from './helpText.json'

/** Keys of the six help sentences (design.md section 11.4). */
export const HELP_KEYS = [
  'harmonized_count',
  'uncertainty_interval',
  'baseline_median',
  'anomaly',
  'z_score',
  'percentile_rank',
] as const

export type HelpKey = (typeof HELP_KEYS)[number]

const HELP_TEXT: Record<HelpKey, string> = helpTextJson

/** Returns the help sentence for a term. The sentences live only in `helpText.json`. */
export function helpText(key: HelpKey): string {
  return HELP_TEXT[key]
}
