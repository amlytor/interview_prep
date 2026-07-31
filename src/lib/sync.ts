// Cross-tab notification.
//
// commitData() already makes concurrent tabs SAFE — every change is applied to
// the live stored state, so nothing gets clobbered. This makes them CONSISTENT:
// without it, a second tab shows a snapshot frozen at the moment it loaded,
// which is confusing even when nothing is lost. A tab announces each commit and
// its siblings re-read.
//
// Only the revision number crosses the channel, never the payload — the data is
// megabytes, and every tab can read it from IndexedDB itself.

const CHANNEL_NAME = "quantprep-sync";

function channel(): BroadcastChannel | null {
  // Absent in a few older browsers; the app is simply back to one live tab.
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

// One channel per tab, opened lazily and kept for the life of the page.
let shared: BroadcastChannel | null | undefined;
function sharedChannel(): BroadcastChannel | null {
  if (shared === undefined) shared = channel();
  return shared;
}

/** Tell other tabs that the stored state has moved on. */
export function announceCommit(revision: number): void {
  try {
    sharedChannel()?.postMessage({ revision });
  } catch {
    // A closed or failed channel costs live sync, nothing else.
  }
}

/**
 * Subscribe to other tabs' commits. Returns an unsubscribe function.
 *
 * A BroadcastChannel never delivers a tab its own messages, so there is no
 * echo to filter out here.
 */
export function onRemoteCommit(handler: (revision: number) => void): () => void {
  const bus = sharedChannel();
  if (!bus) return () => {};
  const listener = (event: MessageEvent) => {
    const revision = (event.data as { revision?: unknown } | null)?.revision;
    if (typeof revision === "number") handler(revision);
  };
  bus.addEventListener("message", listener);
  return () => bus.removeEventListener("message", listener);
}
