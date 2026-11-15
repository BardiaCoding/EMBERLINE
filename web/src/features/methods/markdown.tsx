import type { ReactNode } from 'react'

// A deliberately small Markdown renderer for docs/methodology.md. It builds React elements
// (never raw HTML), so the document cannot inject markup. Supported: `##` and `###` headings,
// paragraphs, `-` lists, **bold**, `code` and [text](url) links with http, https or
// relative targets. Anything else is shown as plain text.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const SAFE_URL = /^(https?:\/\/|\/|#)/i

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${String(index)}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded-sm bg-muted px-1 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = LINK.exec(part)
    if (link?.[1] !== undefined && link[2] !== undefined && SAFE_URL.test(link[2])) {
      return (
        <a key={key} href={link[2]} className="underline underline-offset-4 hover:text-primary">
          {link[1]}
        </a>
      )
    }
    return part
  })
}

/**
 * Renders Markdown as React nodes. `##` becomes an h3 and `###` an h4, because the page
 * title is the h2 above the document. A single `#` title line is skipped.
 */
export function renderMarkdown(source: string): ReactNode[] {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const nodes: ReactNode[] = []
  blocks.forEach((raw, index) => {
    const block = raw.trim()
    const key = `b${String(index)}`
    if (block === '' || /^#\s/.test(block)) return
    if (block.startsWith('### ')) {
      nodes.push(
        <h4 key={key} className="mt-4 mb-1 text-sm font-semibold">
          {inline(block.slice(4), key)}
        </h4>,
      )
    } else if (block.startsWith('## ')) {
      nodes.push(
        <h3 key={key} className="mt-6 mb-2 text-base font-semibold">
          {inline(block.slice(3), key)}
        </h3>,
      )
    } else if (block.split('\n').every((line) => /^[-*] /.test(line))) {
      nodes.push(
        <ul key={key} className="my-2 list-disc space-y-1 pl-5">
          {block.split('\n').map((line, i) => (
            <li key={`${key}-${String(i)}`}>{inline(line.slice(2), `${key}-${String(i)}`)}</li>
          ))}
        </ul>,
      )
    } else {
      nodes.push(
        <p key={key} className="my-2">
          {inline(block.replace(/\n/g, ' '), key)}
        </p>,
      )
    }
  })
  return nodes
}
