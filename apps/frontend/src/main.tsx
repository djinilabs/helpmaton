import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from './App'
import { setupGlobalFetchOverride } from './utils/api'
import { initPostHog } from './utils/posthog'
import { initSentry } from './utils/sentry'
import { registerServiceWorker } from './utils/serviceWorker'

// Initialize theme before React renders to prevent flash
function initializeTheme() {
  const stored = localStorage.getItem('theme');
  let preference: 'light' | 'dark' | 'system' = 'system';
  
  if (stored && stored !== 'undefined') {
    try {
      const parsed = JSON.parse(stored);
      if (parsed === 'light' || parsed === 'dark' || parsed === 'system') {
        preference = parsed;
      }
    } catch {
      // Invalid stored value, use system default
    }
  }

  let theme: 'light' | 'dark';
  if (preference === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    theme = preference;
  }

  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

// Initialize theme before React rendering
initializeTheme()

// Initialize Sentry before React rendering
initSentry()

// Initialize PostHog before React rendering
initPostHog()

// Setup global fetch override to automatically add Authorization header
// This prevents race conditions and ensures all fetch calls include the token
setupGlobalFetchOverride()

// Register service worker for static asset caching
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
