import { useId, useRef, useState, type ChangeEvent } from 'react'
import { readGeoJsonFile } from './geojsonFile'

type GeoJsonUploadProps = {
  /** Called with the parsed content of a file that passed the local checks. */
  onSubmit: (content: Record<string, unknown>) => void
}

/**
 * GeoJSON file upload, up to 5 MB (requirements 12.5, 12.7). A file that is too large or not
 * JSON gets a message here and nothing is sent. The server checks the shapes, unions the
 * polygon features and reports the others as ignored; its rejection is shown by `AreaMessages`.
 * Either way the previous area and its
 * results stay (requirement 13.9).
 */
export function GeoJsonUpload({ onSubmit }: GeoJsonUploadProps) {
  const ids = useId()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const errorId = `${ids}-error`
  const hintId = `${ids}-hint`
  const shown = error

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file === undefined) return
    const result = await readGeoJsonFile(file)
    // The same file can be chosen again after a fix.
    if (input.current !== null) input.current.value = ''
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    onSubmit(result.content)
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${ids}-file`} className="text-sm font-semibold">
        Upload GeoJSON
      </label>
      <p id={hintId} className="text-xs text-muted-foreground">
        A .geojson or .json file up to 5 MB. Polygon features are combined; other features are
        ignored.
      </p>
      <input
        ref={input}
        id={`${ids}-file`}
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        className="text-sm"
        onChange={(event) => {
          void choose(event)
        }}
        aria-invalid={shown !== null}
        aria-describedby={shown === null ? hintId : `${hintId} ${errorId}`}
      />
      {shown !== null && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {shown} The previous area and its results are unchanged.
        </p>
      )}
    </div>
  )
}
