/** True for `/methods` and `/methods/` (the page is served by the SPA fallback). */
export function isMethodsPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === '/methods'
}
