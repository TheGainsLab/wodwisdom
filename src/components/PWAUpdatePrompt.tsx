import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-banner">
      <span>A new version of GAINS is available.</span>
      <button onClick={() => updateServiceWorker(true)}>Update</button>
      {/*
        Dismiss is deliberately session-scoped — it clears the hook's flag
        rather than persisting anything, so the banner returns on the next load
        and on any subsequent update event. Users parked indefinitely on a stale
        bundle is how version skew turns into "the app is broken" reports, so
        the nag should keep coming back; it just shouldn't sit on top of the
        page you're trying to read (it is fixed at z-index 10000 and was
        covering content on every screen).
      */}
      <button
        className="pwa-update-dismiss"
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss until next load"
      >
        ×
      </button>
    </div>
  );
}
