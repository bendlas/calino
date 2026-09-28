import { expect, test } from '@playwright/test'
import { clearState, STORAGE_KEYS } from './fixtures/localstorage'

const configuredBasePath = process.env.CALINO_BASE_PATH
const isNonRootBasePath =
  configuredBasePath !== undefined && configuredBasePath !== '.' && configuredBasePath !== '/'

test.describe('base path', () => {
  test.skip(!isNonRootBasePath, 'Run with CALINO_BASE_PATH set to a non-root value.')

  test('app routes and static assets resolve under the configured base path', async ({
    page,
    baseURL,
    request,
  }) => {
    await clearState(page)

    const basePath = configuredBasePath as string
    const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const baseAppUrl = new URL(basePath, baseURL).toString()

    const iconResponse = await page.goto(new URL('apple-touch-icon.png', baseAppUrl).toString())
    expect(iconResponse?.ok()).toBe(true)

    const sampleEventsResponse = await request.get(new URL('sample-events.ics', baseAppUrl).toString())
    expect(sampleEventsResponse?.ok()).toBe(true)

    await page.goto(new URL('settings?tab=data', baseAppUrl).toString())
    await expect(page).toHaveURL(new RegExp(`${escapedBasePath}settings\\?tab=data$`))

    await page.goto(new URL('year', baseAppUrl).toString())
    await page.locator('[data-component="brand-home"]').click()
    await expect(page).toHaveURL(new RegExp(`${escapedBasePath}month$`))
  })

  test('onboarding demo data loads sample files from the configured base path', async ({
    page,
    baseURL,
  }) => {
    await clearState(page)
    await page.addInitScript(({ settingsKey }: { settingsKey: string }) => {
      const raw = localStorage.getItem(settingsKey)
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
      parsed.state = { ...(parsed.state ?? {}), hasCompletedOnboarding: false }
      localStorage.setItem(settingsKey, JSON.stringify(parsed))
    }, { settingsKey: STORAGE_KEYS.settings })

    const basePath = configuredBasePath as string
    const baseAppUrl = new URL(basePath, baseURL).toString()
    const sampleEventsPath = new URL('sample-events.ics', baseAppUrl).pathname
    const observedRequests: string[] = []

    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (pathname.endsWith('/sample-events.ics')) observedRequests.push(pathname)
    })

    await page.goto(baseAppUrl)
    await page.locator('[data-component="demo-button"]').click()
    await expect.poll(() => observedRequests).toContain(sampleEventsPath)
  })
})
