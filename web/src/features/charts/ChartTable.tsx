import { cn } from '@/lib/utils'

type ChartTableProps = {
  /** Accessible caption: what the table holds and its unit. */
  caption: string
  columns: readonly string[]
  /** One array of cell texts per row, in the order of `columns`. The first cell is the row header. */
  rows: readonly (readonly string[])[]
  className?: string
}

/**
 * Data table alternative of a chart (requirement 27.3): the same values as the chart, as text,
 * with signs and status words so that nothing depends on colour.
 */
export function ChartTable({ caption, columns, rows, className }: ChartTableProps) {
  return (
    <table className={cn('w-full border-collapse text-sm tabular-nums', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column}
              scope="col"
              className="border-b border-border px-2 py-1 text-left font-medium"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${i}-${row[0] ?? ''}`}>
            {row.map((cell, j) =>
              j === 0 ? (
                <th
                  key={`${j}-${cell}`}
                  scope="row"
                  className="border-b border-border px-2 py-1 text-left font-normal"
                >
                  {cell}
                </th>
              ) : (
                <td key={`${j}-${cell}`} className="border-b border-border px-2 py-1">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
