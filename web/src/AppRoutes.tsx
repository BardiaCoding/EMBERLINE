import { App } from './App'
import { MethodsPage } from './features/methods/MethodsPage'
import { isMethodsPath } from './features/methods/path'

/**
 * Minimal path-based switch: `/methods` shows the methods page, every other path the app.
 * Links are plain anchors, so a click loads the page from the server, which answers client
 * routes with `index.html`.
 */
export function AppRoutes() {
  return isMethodsPath(window.location.pathname) ? <MethodsPage /> : <App />
}
