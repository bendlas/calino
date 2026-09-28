import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * A self-hosted deployment can bake settings defaults into
 * `calino.config.json`. They seed the store's initial state; a value the user
 * changed (persisted in localStorage) must still win.
 *
 * The defaults are read while `settingsStore` initialises, so each case needs a
 * fresh module instance with the build-time global already in place.
 *
 * `src/test/setup.ts` replaces localStorage with bare `vi.fn()` stubs, so this
 * suite swaps in a Map-backed implementation first: without it persist could
 * neither read a stored value nor report one to the assertions.
 */
const globalWithConfig = globalThis as Record<string, unknown>

function useBackingStorage(): void {
  const map = new Map<string, string>()
  const storage = globalThis.localStorage as unknown as {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
    clear: () => void
    key: (index: number) => string | null
  }
  storage.getItem = (key) => (map.has(key) ? map.get(key)! : null)
  storage.setItem = (key, value) => {
    map.set(key, String(value))
  }
  storage.removeItem = (key) => {
    map.delete(key)
  }
  storage.clear = () => map.clear()
  storage.key = (index) => Array.from(map.keys())[index] ?? null
  Object.defineProperty(globalThis.localStorage, 'length', {
    get: () => map.size,
    configurable: true,
  })
}

async function loadSettingsWith(config: unknown) {
  globalWithConfig.__CALINO_CONFIG__ = config
  vi.resetModules()
  const { useSettingsStore } = await import('@/store/settingsStore')
  // persist rehydrates asynchronously; wait so a stored value is reflected
  // before we read the state.
  await useSettingsStore.persist.rehydrate()
  return useSettingsStore.getState()
}

describe('settingsStore baked config defaults', () => {
  beforeEach(() => {
    useBackingStorage()
    localStorage.clear()
  })

  afterEach(() => {
    delete globalWithConfig.__CALINO_CONFIG__
  })

  it('seeds duration, start time, all-day, and a None reminder from config', async () => {
    const state = await loadSettingsWith({
      version: 1,
      accounts: [],
      settings: {
        defaultDuration: 90,
        defaultStartTime: '18:00',
        defaultAllDay: true,
        defaultReminderMinutes: null,
      },
    })

    expect(state.defaultDuration).toBe(90)
    expect(state.defaultStartTime).toBe('18:00')
    expect(state.defaultAllDay).toBe(true)
    expect(state.defaultReminderMinutes).toBeNull()
  })

  it('falls back to the built-in defaults when nothing is baked', async () => {
    const state = await loadSettingsWith(null)

    expect(state.defaultDuration).toBe(60)
    expect(state.defaultStartTime).toBe('09:00')
    expect(state.defaultAllDay).toBe(false)
    expect(state.defaultReminderMinutes).toBe(15)
  })

  it('lets persisted settings win over the baked defaults', async () => {
    localStorage.setItem(
      'calino-settings',
      JSON.stringify({ state: { defaultStartTime: '07:30' }, version: 4 })
    )

    const state = await loadSettingsWith({
      version: 1,
      accounts: [],
      settings: { defaultStartTime: '18:00' },
    })

    expect(state.defaultStartTime).toBe('07:30')
  })
})
