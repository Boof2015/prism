import { useState, type JSX } from 'react'
import { useUiStore, type UiBannerAction } from '../stores/uiStore'

async function handleBannerAction(
  action: UiBannerAction,
  bannerId: number,
  dismissBanner: (bannerId?: number) => void,
  setPendingAction: (label: string | null) => void,
): Promise<void> {
  setPendingAction(action.label)
  try {
    await action.onSelect?.()
  } finally {
    setPendingAction(null)
    if (action.dismissOnSelect ?? true) {
      dismissBanner(bannerId)
    }
  }
}

export default function AppBanner(): JSX.Element | null {
  const banner = useUiStore((state) => state.banner)
  const dismissBanner = useUiStore((state) => state.dismissBanner)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  if (!banner) {
    return null
  }

  return (
    <div className="app-banner-layer" aria-live="polite">
      <div className={`app-banner app-banner--${banner.tone}`.trim()} role="status">
        <div className="app-banner__message">{banner.message}</div>
        <div className="app-banner__actions">
          {banner.actions.map((action) => (
            <button
              key={`${banner.id}:${action.label}`}
              type="button"
              className="app-banner__action"
              disabled={pendingAction !== null}
              onClick={() => {
                void handleBannerAction(action, banner.id, dismissBanner, setPendingAction)
              }}
            >
              {pendingAction === action.label ? 'Working...' : action.label}
            </button>
          ))}
          <button
            type="button"
            className="app-banner__dismiss"
            onClick={() => dismissBanner(banner.id)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
