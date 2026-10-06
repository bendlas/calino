import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import { clearState, seedAccount } from './fixtures/localstorage'

/**
 * A `browser-session` account authenticates with the gateway cookie, so a
 * rejected request means the browser session is gone. The gateway answers with
 * a cross-origin login redirect, which `fetch` cannot follow (CORS) — without
 * the fix that surfaced as a bare "Failed to fetch" and the calendar just
 * stopped syncing. The app must instead bounce the tab through login exactly
 * once, not loop while the session stays dead.
 */
test('a rejected browser session reloads the app once instead of failing silently', async ({
  page,
}) => {
  await clearState(page)

  const requests: string[] = []
  // Isolated origin: this test owns the server, so it cannot disturb the
  // shared same-origin mock that the rest of the (parallel) suite uses.
  const dav = createServer((request, response) => {
    const origin = request.headers.origin ?? '*'
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS, PROPFIND, REPORT',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Depth, If-Match, If-None-Match',
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors).end()
      return
    }
    requests.push(request.method ?? '')
    // No `WWW-Authenticate`, so the browser does not pop a Basic dialog; this
    // is a cookie session the gateway has stopped accepting.
    response.writeHead(401, { ...cors, 'Content-Type': 'text/plain' }).end('session expired')
  })
  await new Promise<void>((resolve) => dav.listen(0, '127.0.0.1', resolve))
  const davUrl = `http://127.0.0.1:${(dav.address() as AddressInfo).port}/dav/`

  try {
    await seedAccount(page, {
      id: 'expired-session',
      name: 'Expired session',
      serverUrl: davUrl,
      username: 'user',
      password: '',
      authMode: 'browser-session',
    })

    let loads = 0
    page.on('load', () => {
      loads += 1
    })

    await page.goto('/')
    await expect.poll(() => loads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    // The once-per-tab guard must stop the bounce while the session stays dead.
    await page.waitForTimeout(1500)
    expect(loads).toBe(2)
    expect(requests.length).toBeGreaterThan(0)
  } finally {
    await new Promise<void>((resolve) => dav.close(() => resolve()))
  }
})
