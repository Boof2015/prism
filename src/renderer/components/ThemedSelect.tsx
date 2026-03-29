import type { JSX, SelectHTMLAttributes } from 'react'

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 6.5 8 10l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ThemedSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  className?: string
}

export default function ThemedSelect({
  className,
  children,
  ...props
}: ThemedSelectProps): JSX.Element {
  return (
    <div className={['settings-control__select', 'themed-select', className].filter(Boolean).join(' ')}>
      <select className="themed-select__control" {...props}>
        {children}
      </select>
      <span className="themed-select__chevron" aria-hidden="true">
        <ChevronIcon />
      </span>
    </div>
  )
}
