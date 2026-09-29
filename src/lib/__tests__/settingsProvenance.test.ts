import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  getBakedSettingOverrides,
  describeBakedSettingOverrides,
  logSettingsProvenance,
} from '../settingsProvenance'

const originalGlobal = globalThis as Record<string, unknown>

afterEach(() => {
  delete originalGlobal.__CALINO_CONFIG__
})

function bakeSettings(settings: Record<string, unknown>): void {
  originalGlobal.__CALINO_CONFIG__ = { version: 1, accounts: [], settings }
}

describe('settingsProvenance', () => {
  it('reports nothing when no settings are baked', () => {
    expect(getBakedSettingOverrides({ defaultStartTime: '18:00' })).toEqual([])
  })

  it('reports only baked keys whose saved value differs', () => {
    bakeSettings({
      defaultStartTime: '19:00',
      defaultAllDay: true,
      defaultDuration: 60,
    })

    const overrides = getBakedSettingOverrides({
      defaultStartTime: '18:00', // differs
      defaultAllDay: true, // matches
      defaultDuration: 90, // differs
    })

    expect(overrides).toEqual([
      { key: 'defaultStartTime', baked: '19:00', effective: '18:00' },
      { key: 'defaultDuration', baked: 60, effective: 90 },
    ])
  })

  it('ignores baked keys the browser never saved', () => {
    bakeSettings({ defaultStartTime: '19:00', defaultAllDay: true })

    expect(getBakedSettingOverrides({})).toEqual([])
  })

  it('compares a null reminder against a number default', () => {
    bakeSettings({ defaultReminderMinutes: null })

    expect(getBakedSettingOverrides({ defaultReminderMinutes: 15 })).toEqual([
      { key: 'defaultReminderMinutes', baked: null, effective: 15 },
    ])
    expect(getBakedSettingOverrides({ defaultReminderMinutes: null })).toEqual([])
  })

  it('describes overrides in one line', () => {
    const description = describeBakedSettingOverrides([
      { key: 'defaultStartTime', baked: '19:00', effective: '18:00' },
    ])

    expect(description).toBe('defaultStartTime: browser="18:00" config="19:00"')
  })

  it('logs a no-config note, applied defaults, or the overrides', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    logSettingsProvenance({})
    expect(info).toHaveBeenLastCalledWith(
      '[Calino] No settings baked in calino.config.json.'
    )

    bakeSettings({ defaultStartTime: '19:00' })
    logSettingsProvenance({ defaultStartTime: '19:00' })
    expect(info).toHaveBeenLastCalledWith('[Calino] Using calino.config.json settings defaults:', {
      defaultStartTime: '19:00',
    })

    logSettingsProvenance({ defaultStartTime: '18:00' })
    expect(info).toHaveBeenLastCalledWith(
      '[Calino] Browser-saved settings override calino.config.json: defaultStartTime: browser="18:00" config="19:00"'
    )

    info.mockRestore()
  })
})
