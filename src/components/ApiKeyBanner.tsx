import type { Page } from "../App";

export function ApiKeyBanner({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <div className="banner banner-warn">
      <p>
        No Anthropic API key set — free-text answers can't be graded until you add one.
      </p>
      <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("settings")}>
        Go to Settings
      </button>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner-error">
      <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
