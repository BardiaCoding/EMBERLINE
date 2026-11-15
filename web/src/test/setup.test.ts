import fc from 'fast-check'
import { http, HttpResponse } from 'msw'
import { server } from './server'

describe('test setup', () => {
  it('configures fast-check with 100 runs and seed 2026', () => {
    const params = fc.readConfigureGlobal()
    expect(params.numRuns).toBe(100)
    expect(params.seed).toBe(2026)
  })

  it('fails requests that have no msw handler', async () => {
    await expect(fetch('http://localhost/api/v1/unhandled')).rejects.toThrow()
  })

  it('answers requests that have a handler', async () => {
    server.use(http.get('http://localhost/api/health', () => HttpResponse.json({ ok: true })))
    const response = await fetch('http://localhost/api/health')
    expect(await response.json()).toEqual({ ok: true })
  })
})
