import { expect, test } from '@playwright/test'
import { clearState } from './fixtures/localstorage'

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
})
