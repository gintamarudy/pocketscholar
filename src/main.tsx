import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Installable PWA: the service worker (vite-plugin-pwa, autoUpdate) serves
// the cached app shell + Tesseract stack when offline. Registration is
// immediate so the first visit already caches everything for offline use.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
