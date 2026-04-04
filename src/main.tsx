import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ScrollToTop from './components/ScrollToTop';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import OfflineBanner from './components/OfflineBanner';
import { setupAutoSync } from './lib/offlineSync';
import './index.css';
import './engine.css';
import './nutrition.css';
import './ailog.css';
import './mobile.css';

// Auto-sync queued mutations when coming back online
setupAutoSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <PWAUpdatePrompt />
      <OfflineBanner />
      <App />
    </BrowserRouter>
  </StrictMode>
);
