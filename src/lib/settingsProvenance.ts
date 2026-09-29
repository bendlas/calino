/**
 * Settings provenance diagnostic.
 *
 * `calino.config.json` can seed a few defaults (see `CalinoConfigSettings`).
 * Those are defaults only: once a value is saved in the browser, the persisted
 * state wins over the baked one. When a self-hosted deployment changes its
 * config, a browser that already saved settings keeps the old values, which is
 * confusing to diagnose. These helpers spell out exactly which baked keys the
 * browser is overriding so the mismatch is visible (logged at hydration, and
 * surfaced in the Settings UI).
 */
import { getBakedSettingsDefaults } from '@/lib/configLoader'
import type { UserSettings } from '@/types'

/** Settings keys that `calino.config.json` can bake. */
export type BakedSettingKey =
  | 'defaultReminderMinutes'
  | 'defaultStartTime'
  | 'defaultAllDay'
  | 'defaultDuration'

export const BAKED_SETTING_KEYS: readonly BakedSettingKey[] = [
  'defaultReminderMinutes',
  'defaultStartTime',
  'defaultAllDay',
  'defaultDuration',
] as const

export interface BakedSettingOverride {
  key: BakedSettingKey
  /** Value from `calino.config.json`. */
  baked: UserSettings[BakedSettingKey]
  /** Effective value, i.e. what the saved browser settings carry. */
  effective: UserSettings[BakedSettingKey]
}

/**
 * Baked keys whose effective value differs from the config. Keys the config
 * does not set are ignored, and a key the browser never saved falls back to the
 * baked value (so it is not reported as an override).
 */
export function getBakedSettingOverrides(
  state: Partial<UserSettings>
): BakedSettingOverride[] {
  const baked = getBakedSettingsDefaults()
  const overrides: BakedSettingOverride[] = []

  for (const key of BAKED_SETTING_KEYS) {
    const bakedValue = baked[key]
    if (bakedValue === undefined) continue
    const effectiveValue = state[key]
    if (effectiveValue !== undefined && effectiveValue !== bakedValue) {
      overrides.push({ key, baked: bakedValue, effective: effectiveValue })
    }
  }

  return overrides
}

/** One compact English line per override, for the dev console. */
export function describeBakedSettingOverrides(overrides: BakedSettingOverride[]): string {
  return overrides
    .map(
      ({ key, baked, effective }) =>
        `${key}: browser=${JSON.stringify(effective)} config=${JSON.stringify(baked)}`
    )
    .join('; ')
}

/**
 * Log the baked settings and any browser overrides. Runs once per load, after
 * the settings store hydrates, so an operator can tell a stale deploy (nothing
 * is baked) from persisted-settings-wins (baked and overridden).
 */
export function logSettingsProvenance(state: Partial<UserSettings>): void {
  const baked = getBakedSettingsDefaults()
  if (Object.keys(baked).length === 0) {
    console.info('[Calino] No settings baked in calino.config.json.')
    return
  }

  const overrides = getBakedSettingOverrides(state)
  if (overrides.length === 0) {
    console.info('[Calino] Using calino.config.json settings defaults:', baked)
    return
  }

  console.info(
    `[Calino] Browser-saved settings override calino.config.json: ${describeBakedSettingOverrides(
      overrides
    )}`
  )
}
