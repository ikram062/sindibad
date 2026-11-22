import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type DropdownOption<T extends string> = { value: T; label: string; /** Shown on the button in `compact` mode. */ short?: string }

/**
 * A styled dropdown that replaces the browser's own <select> menu, which cannot be themed.
 * Keyboard: Enter/Space/ArrowDown open it, arrows/Home/End move, Enter picks, Escape closes and returns focus.
 * The list anchors to the end edge, so it stays on screen in both left-to-right and right-to-left layouts.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  compact = false,
  placement = 'down',
  className = '',
}: {
  value: T
  options: DropdownOption<T>[]
  onChange: (v: T) => void
  /** Accessible name, e.g. "Language". */
  label: string
  icon?: ReactNode
  compact?: boolean
  placement?: 'down' | 'up'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]!

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    // Move focus into the list, onto the current choice.
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])

  const onListKey = (e: KeyboardEvent) => {
    const els = items()
    const i = els.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      els[(n + els.length) % els.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(els.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }

  const choose = (v: T) => {
    onChange(v)
    setOpen(false)
    trigger.current?.focus()
  }

  const triggerStyle = compact
    ? 'inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-semibold text-brand/70 hover:bg-brand/5 hover:text-brand'
    : 'inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-white/80 px-3 py-1.5 text-sm font-medium text-brand hover:border-gold'

  return (
    <div ref={root} className={className}>
      <div className="relative">
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
            }
          }}
          className={`${triggerStyle} outline-none transition focus-visible:ring-2 focus-visible:ring-gold/60`}
        >
          {icon}
          <span>{compact ? (current.short ?? current.label) : current.label}</span>
          <ChevronDown className={`size-4 text-brand/50 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>

        {open && (
          <div
            ref={list}
            role="listbox"
            aria-label={label}
            onKeyDown={onListKey}
            className={`absolute end-0 z-50 min-w-40 overflow-hidden rounded-2xl border border-brand/10 bg-white p-1.5 shadow-xl ${
              placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
          >
            {options.map((o) => {
              const selected = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(o.value)}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-start text-sm outline-none transition hover:bg-brand/5 focus:bg-brand/5 ${
                    selected ? 'font-semibold text-brand' : 'text-ink/80'
                  }`}
                >
                  <span>{o.label}</span>
                  {selected && <Check className="size-4 text-gold" aria-hidden />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
