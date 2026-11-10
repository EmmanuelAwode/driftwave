import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { engine } from './audio/engine'
import { useApp } from './state/store'

// Automation / diagnostics hook (used by the end-to-end test harness).
;(window as unknown as Record<string, unknown>).__driftwave = { engine, useApp }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
