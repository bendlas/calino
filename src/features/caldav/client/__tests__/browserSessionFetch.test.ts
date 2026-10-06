import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserSessionFetch,
  resetReauthGuard,
  SessionExpiredError,
} from '../browserSessionFetch'

/** `Response` cannot be constructed as an opaque redirect; only `.type`/`.status` are read. */
function opaqueRedirect(): Response {
  return { type: 'opaqueredirect', status: 0 } as unknown as Response
}

describe('browser-session DAV fetch', () => {
  beforeEach(() => {
    resetReauthGuard()
  })

  it('attaches credentials and passes normal responses through', async () => {
    const base = vi.fn(async () => new Response(null, { status: 207 })) as unknown as typeof fetch
    const reload = vi.fn()
    const davFetch = createBrowserSessionFetch(base, { reload })

    const response = await davFetch('https://dav.example/cal/', { method: 'PROPFIND' })

    expect(response.status).toBe(207)
    expect(vi.mocked(base).mock.calls[0][1]!.credentials).toBe('include')
    expect(reload).not.toHaveBeenCalled()
  })

  it('detects a cross-origin login redirect hidden as a CORS TypeError and reloads once', async () => {
    const base = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const transport = vi.fn(async () => opaqueRedirect()) as unknown as typeof fetch
    const reload = vi.fn()
    const davFetch = createBrowserSessionFetch(base, { transport, reload })

    await expect(davFetch('https://dav.example/cal/', { method: 'PROPFIND' })).rejects.toThrow(
      SessionExpiredError
    )

    const probeInit = vi.mocked(transport).mock.calls[0][1]!
    expect(probeInit.redirect).toBe('manual')
    expect(probeInit.credentials).toBe('include')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('rethrows a genuine network failure without reloading', async () => {
    const base = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const transport = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch
    const reload = vi.fn()
    const davFetch = createBrowserSessionFetch(base, { transport, reload })

    await expect(davFetch('https://dav.example/cal/')).rejects.toThrow('Failed to fetch')
    expect(reload).not.toHaveBeenCalled()
  })

  it('treats a 401 as an expired session and reloads', async () => {
    const base = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
    const reload = vi.fn()
    const davFetch = createBrowserSessionFetch(base, { reload })

    const response = await davFetch('https://dav.example/cal/', { method: 'PROPFIND' })
    expect(response.status).toBe(401)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads at most once per page, across accounts', async () => {
    const base = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
    const reload = vi.fn()
    const first = createBrowserSessionFetch(base, { reload })
    const second = createBrowserSessionFetch(base, { reload })

    await first('https://dav.example/one/')
    await second('https://dav.example/two/')

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload again in a tab that already bounced without recovering', async () => {
    sessionStorage.setItem('calino.reauthAttempted', '1')
    const base = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
    const reload = vi.fn()
    const davFetch = createBrowserSessionFetch(base, { reload })

    const response = await davFetch('https://dav.example/cal/')

    expect(response.status).toBe(401)
    expect(reload).not.toHaveBeenCalled()
  })

  it('clears the bounce marker once a request succeeds', async () => {
    sessionStorage.setItem('calino.reauthAttempted', '1')
    const base = vi.fn(async () => new Response(null, { status: 207 })) as unknown as typeof fetch
    const davFetch = createBrowserSessionFetch(base, { reload: vi.fn() })

    await davFetch('https://dav.example/cal/')

    expect(sessionStorage.getItem('calino.reauthAttempted')).toBeNull()
  })
})
