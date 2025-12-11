import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from './App'
import { setupGlobalFetchOverride } from './utils/api'
import { initPostHog } from './utils/posthog'
import { initSentry } from './utils/sentry'

// Initialize Sentry before React rendering
initSentry()

// Initialize PostHog before React rendering
initPostHog()

// Setup global fetch override to automatically add Authorization header
// This prevents race conditions and ensures all fetch calls include the token
setupGlobalFetchOverride()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
