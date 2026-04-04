import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useEffect, useState } from 'react';
import { queueSize } from '../lib/offlineCache';

export default function OfflineBanner() {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!online) {
      queueSize().then(setPending);
    }
  }, [online]);

  if (online) return null;

  return (
    <div className="offline-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span>You're offline{pending > 0 ? ` \u2022 ${pending} pending` : ''}</span>
    </div>
  );
}

/**
 * Inline message for features that require network (AI chat, food search, etc.)
 */
export function OfflineMessage({ feature }: { feature: string }) {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div className="offline-message">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{feature} requires an internet connection. Your data will sync when you're back online.</span>
    </div>
  );
}
