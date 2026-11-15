import { useId, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import type { ExampleArea } from '@/lib/api'
import { parseAreaGeometry, type AreaGeometry } from '@/lib/areaGeometry'

type ExampleAreasProps = {
  /** `example_areas` of `/meta`. Undefined while `/meta` loads or when it failed. */
  areas: readonly ExampleArea[] | undefined
  /** Runs the same path as a drawn shape (requirement 11.15). */
  onSelect: (geometry: AreaGeometry, name: string) => void
}

/**
 * One-click example areas (requirements 11.14 to 11.17). Names, descriptions and geometries
 * come only from `/meta`, so none are written in this source. Renders nothing when the list is
 * missing or empty, so a failed `/meta` request leaves every other control available. Each
 * button is labelled with the name, and the description is its accessible description.
 */
export function ExampleAreas({ areas, onSelect }: ExampleAreasProps) {
  const ids = useId()
  const usable = useMemo(
    () =>
      (areas ?? []).flatMap((area) => {
        const geometry = parseAreaGeometry(area.geometry)
        return geometry === null
          ? []
          : [{ name: area.name, description: area.description, geometry }]
      }),
    [areas],
  )
  if (usable.length === 0) return null
  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-2">
      <h3 id={`${ids}-title`} className="text-sm font-semibold">
        Example areas
      </h3>
      <ul className="flex flex-col gap-2">
        {usable.map((area, index) => {
          const descriptionId = `${ids}-description-${index}`
          return (
            <li key={`${area.name}-${index}`} className="flex flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start"
                aria-describedby={descriptionId}
                onClick={() => {
                  onSelect(area.geometry, area.name)
                }}
              >
                {area.name}
              </Button>
              <p id={descriptionId} className="text-xs text-muted-foreground">
                {area.description}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
