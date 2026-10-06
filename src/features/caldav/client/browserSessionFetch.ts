import { webFetch } from '@/lib/webFetch'

/**
 * Raised when a `browser-session` account's cookie is no longer accepted by the
 * server's authentication gateway.
 *
 * The gateway answers a cookie-less/expired DAV request with an HTTP redirect
 * to its login page. Because that page is on a different origin and does not
 * send CORS headers, `fetch` cannot follow it: it rejects with a bare
 * `TypeError: Failed to fetch`, which looks like a network outage. This error
 * replaces that opaque failure so callers can tell "re-authenticate" apart from
 * "the network is down".
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('CalDAV session expired (401): the browser session is no longer signed in.')
    this.name = 'SessionExpiredError'
  }
}

/** Short timeout for the classification probe so a hung gateway cannot stall the error path. */
const AUTH_PROBE_TIMEOUT_MS = 5_000

/**
 * Survives the reload, so a session that is still rejected after one bounce
 * does not put the tab in a reload loop. Cleared once a DAV request succeeds.
 */
const REAUTH_MARKER = 'calino.reauthAttempted'

/**
 * Module-level, not per-wrapper: a page can build several CalDAV clients (one
 * per account) and one expired session must only bounce the browser once.
 */
let reauthTriggered = false

function hasReauthMarker(): boolean {
  try {
    return sessionStorage.getItem(REAUTH_MARKER) === '1'
  } catch {
    return false
  }
}

function setReauthMarker(): void {
  try {
    sessionStorage.setItem(REAUTH_MARKER, '1')
  } catch {
    /* sessionStorage unavailable */
  }
}

function clearReauthMarker(): void {
  try {
    sessionStorage.removeItem(REAUTH_MARKER)
  } catch {
    /* sessionStorage unavailable */
  }
}

/** Test seam: allow a second auto-redirect in the same module instance. */
export function resetReauthGuard(): void {
  reauthTriggered = false
  clearReauthMarker()
}

export interface BrowserSessionFetchOptions {
  /** Underlying fetch used only for the manual-redirect probe (tests inject a stub). */
  transport?: typeof fetch
  /** How to re-enter the gateway's login flow (tests inject a spy). */
  reload?: () => void
}

/**
 * Wrap a fetch for a `browser-session` CalDAV account so a lost gateway session
 * triggers a one-shot reload of the app.
 *
 * Cookies are the credential, so a 401 or a gateway redirect both mean "the
 * session is gone". The re-login URL is not something Calino has to know: the
 * gateway already produces it for any protected navigation (`…/authelia/?rd=
 * <this page>&rm=GET`). Reloading hands the request back to the browser, which
 * — unlike `fetch` — may follow that cross-origin redirect and render the login
 * form; the provider then returns the user to Calino, whose normal auto-sync
 * runs again.
 *
 * Without a gate (a plain 401 from a genuinely unauthenticated server) reloading
 * once is harmless but does not help; the caller still sees
 * `SessionExpiredError`.
 */
export function createBrowserSessionFetch(
  base: typeof fetch,
  options: BrowserSessionFetchOptions = {}
): typeof fetch {
  const transport = options.transport ?? webFetch
  const reload = options.reload ?? (() => window.location.reload())

  const reenterLogin = (): void => {
    if (reauthTriggered) return
    reauthTriggered = true
    // Already bounced this tab once without a successful request in between:
    // do not reload again, or a server that keeps rejecting loops forever.
    if (hasReauthMarker()) return
    setReauthMarker()
    reload()
  }

  const probeForAuthRedirect = async (input: RequestInfo | URL): Promise<boolean> => {
    const url = input instanceof Request ? input.url : String(input)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AUTH_PROBE_TIMEOUT_MS)
    try {
      const probe = await transport(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
        signal: controller.signal,
      })
      // A manual redirect is surfaced as an opaque-redirect response: status 0
      // with no readable headers or URL. Any real (non-redirect) response,
      // including a 401 or 207, has a nonzero status.
      return probe.type === 'opaqueredirect' || probe.status === 0
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let response: Response
    try {
      response = await base(input, { ...init, credentials: 'include' })
    } catch (error) {
      // Re-issue the request once with `redirect: 'manual'` to tell a gateway
      // login redirect (which CORS hides as a TypeError) from a real failure.
      if (error instanceof TypeError && (await probeForAuthRedirect(input))) {
        reenterLogin()
        throw new SessionExpiredError()
      }
      throw error
    }

    if (response.status === 401) {
      reenterLogin()
    } else if (response.ok) {
      // The session works again; allow a future expiry to bounce once more.
      clearReauthMarker()
    }
    return response
  }
}
