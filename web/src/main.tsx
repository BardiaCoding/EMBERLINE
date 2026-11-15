import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoutes } from './AppRoutes'
import './features/map/mapWorker'
import { QueryProvider } from './lib/QueryProvider'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root not found')
}

createRoot(container).render(
  <StrictMode>
    <QueryProvider>
      <AppRoutes />
    </QueryProvider>
  </StrictMode>,
)
