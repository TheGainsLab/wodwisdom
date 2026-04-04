import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-banner">
      <span>A new version of GAINS is available.</span>
      <button onClick={() => updateServiceWorker(true)}>Update</button>
    </div>
  );
}
