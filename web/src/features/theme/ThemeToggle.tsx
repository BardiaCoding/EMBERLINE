import { Monitor, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { THEME_CHOICES, type ThemeChoice, useTheme } from './theme'

const LABELS: Record<ThemeChoice, { text: string; icon: ReactNode }> = {
  light: { text: 'Light', icon: <Sun aria-hidden="true" className="size-4" /> },
  dark: { text: 'Dark', icon: <Moon aria-hidden="true" className="size-4" /> },
  system: { text: 'System', icon: <Monitor aria-hidden="true" className="size-4" /> },
}

/** Theme control: a radio group of Light, Dark and System. The choice is saved in this browser. */
export function ThemeToggle() {
  const [choice, setChoice] = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-md border border-border"
    >
      {THEME_CHOICES.map((value) => {
        const checked = choice === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={LABELS[value].text}
            title={LABELS[value].text}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              setChoice(value)
            }}
            onKeyDown={(e) => {
              const step =
                e.key === 'ArrowRight' || e.key === 'ArrowDown'
                  ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : 0
              if (step === 0) return
              e.preventDefault()
              const next =
                THEME_CHOICES[
                  (THEME_CHOICES.indexOf(value) + step + THEME_CHOICES.length) %
                    THEME_CHOICES.length
                ]
              if (next === undefined) return
              setChoice(next)
              const buttons = e.currentTarget.parentElement?.querySelectorAll('button')
              buttons?.[THEME_CHOICES.indexOf(next)]?.focus()
            }}
            className={`inline-flex min-h-6 min-w-6 items-center justify-center px-2 py-1 first:rounded-l-md last:rounded-r-md ${
              checked
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-card-foreground hover:bg-accent'
            }`}
          >
            {LABELS[value].icon}
          </button>
        )
      })}
    </div>
  )
}
