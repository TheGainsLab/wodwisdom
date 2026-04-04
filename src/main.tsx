import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ScrollToTop from './components/ScrollToTop';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import './index.css';
import './engine.css';
import './nutrition.css';
import './ailog.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <PWAUpdatePrompt />
      <App />
    </BrowserRouter>
  </StrictMode>
);
