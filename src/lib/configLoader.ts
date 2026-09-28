import { z } from 'zod'
import { isMasterEncryptedData, type MasterEncryptedData } from './crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

export type PreconfiguredAuthMode = 'basic' | 'browser-session'

export interface PreconfiguredAccount {
  name: string
  /**
   * `browser-session` accounts authenticate with cookies the browser already
   * holds (e.g. an Authelia session in front of the DAV server), so they carry
   * no credentials: `url` is a plain string and `username`/`password` are
   * absent. `basic` (the default) keeps the encrypted credential fields.
   */
  authMode?: PreconfiguredAuthMode
  url: MasterEncryptedData | string
  username?: MasterEncryptedData
  password?: MasterEncryptedData
  headers?: Record<string, MasterEncryptedData>
}

export interface PreconfiguredWebcal {
  name: string
  // May embed a secret token in the query string, so encrypted like CalDAV url.
  url: MasterEncryptedData
  refreshIntervalMinutes?: number
  proxyUrl?: string
}

/**
 * Settings a self-hosted deployment can bake into `calino.config.json` to seed
 * fresh browsers. These are the *defaults* only: a user who changes a value in
 * Settings keeps their choice in localStorage (persisted state wins over the
 * seeded default), and every field stays optional.
 */
export interface CalinoConfigSettings {
  /** Reminder seeded into a new event's form. `null` means "None". */
  defaultReminderMinutes?: number | null
  /** `HH:mm` start time for a new timed event. */
  defaultStartTime?: string
  /** Start new events on the clicked day as all-day instead of timed. */
  defaultAllDay?: boolean
}

export interface CalinoConfig {
  version: number
  accounts: PreconfiguredAccount[]
  webcalSubscriptions: PreconfiguredWebcal[]
  settings?: CalinoConfigSettings
}

// ─── Global constant injected at build time ──────────────────────────────────

declare const __CALINO_CONFIG__: Record<string, unknown> | null

// ─── Config loading ──────────────────────────────────────────────────────────

let cachedConfig: CalinoConfig | null | undefined

const MasterEncryptedDataSchema = z.custom<MasterEncryptedData>(
  (value) => isMasterEncryptedData(value),
  { message: 'Expected MasterEncryptedData shape' }
)

const PreconfiguredAccountSchema = z
  .object({
    name: z.string().trim().min(1),
    authMode: z.enum(['basic', 'browser-session']).optional(),
    url: z.union([MasterEncryptedDataSchema, z.string().trim().min(1)]),
    username: MasterEncryptedDataSchema.optional(),
    password: MasterEncryptedDataSchema.optional(),
    headers: z.record(z.string(), MasterEncryptedDataSchema).optional(),
  })
  .superRefine((account, ctx) => {
    if (account.authMode === 'browser-session') {
      // Nothing to decrypt: the URL is a plain string and cookies carry auth.
      if (typeof account.url !== 'string') {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'browser-session accounts must use a plaintext url',
        })
      }
      return
    }
    if (typeof account.url !== 'object') {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'basic accounts must use an encrypted url',
      })
    }
    if (!account.username || !account.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: 'basic accounts must include encrypted username and password',
      })
    }
  })

const PreconfiguredWebcalSchema = z.object({
  name: z.string().trim().min(1),
  url: MasterEncryptedDataSchema,
  refreshIntervalMinutes: z.number().positive().optional(),
  proxyUrl: z.string().trim().min(1).optional(),
})

const CalinoConfigEnvelopeSchema = z.object({
  version: z.literal(1),
  accounts: z.array(z.unknown()),
  webcalSubscriptions: z.array(z.unknown()).optional(),
  settings: z.unknown().optional(),
})

const CalinoConfigSettingsSchema = z.object({
  defaultReminderMinutes: z.union([z.number().int().min(0), z.null()]).optional(),
  defaultStartTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24h HH:mm wall-clock time')
    .optional(),
  defaultAllDay: z.boolean().optional(),
})

/**
 * Validate the baked `settings` block. Unknown fields are stripped (forward
 * compatible); a malformed block is ignored wholesale rather than applied
 * partially, so a typo cannot half-seed the defaults.
 */
function parseSettings(raw: unknown): CalinoConfigSettings | undefined {
  const parsed = CalinoConfigSettingsSchema.safeParse(raw)
  if (!parsed.success) return undefined
  return Object.keys(parsed.data).length > 0 ? parsed.data : undefined
}

/**
 * Read the baked settings defaults synchronously, straight from the build-time
 * global. `settingsStore` needs them while its module initialises (to build
 * `DEFAULT_SETTINGS`), before the async `loadConfig()` ever runs. Mirrors the
 * existing pattern of reading the compile-time `config` for `defaultView`.
 */
export function getBakedSettingsDefaults(): CalinoConfigSettings {
  if (typeof __CALINO_CONFIG__ === 'undefined' || __CALINO_CONFIG__ === null) return {}
  return parseSettings((__CALINO_CONFIG__ as Record<string, unknown>).settings) ?? {}
}

/**
 * Load self-hosted config.
 * The config is baked into the JS bundle at build time (not served as a separate file).
 * Returns null if no config was provided at build time (not self-hosted mode).
 */
export async function loadConfig(): Promise<CalinoConfig | null> {
  // Return cached result if already loaded
  if (cachedConfig !== undefined) {
    return cachedConfig
  }

  // __CALINO_CONFIG__ is injected by Vite's define at build time
  // It's null if calino.config.json doesn't exist
  if (typeof __CALINO_CONFIG__ === 'undefined' || __CALINO_CONFIG__ === null) {
    cachedConfig = null
    return null
  }

  const envelope = CalinoConfigEnvelopeSchema.safeParse(__CALINO_CONFIG__)

  if (!envelope.success) {
    console.warn('[configLoader] Invalid config, ignoring', envelope.error.issues)
    cachedConfig = null
    return null
  }

  const accounts: PreconfiguredAccount[] = []
  for (const raw of envelope.data.accounts) {
    const parsed = PreconfiguredAccountSchema.safeParse(raw)
    if (parsed.success) {
      accounts.push(parsed.data)
    } else {
      console.warn('[configLoader] Skipping invalid account entry', parsed.error.issues)
    }
  }

  const webcalSubscriptions: PreconfiguredWebcal[] = []
  for (const raw of envelope.data.webcalSubscriptions ?? []) {
    const parsed = PreconfiguredWebcalSchema.safeParse(raw)
    if (parsed.success) {
      webcalSubscriptions.push(parsed.data)
    } else {
      console.warn('[configLoader] Skipping invalid webcal subscription entry', parsed.error.issues)
    }
  }

  if (accounts.length === 0 && webcalSubscriptions.length === 0) {
    cachedConfig = null
    return null
  }

  const settings = parseSettings(envelope.data.settings)
  const config: CalinoConfig = {
    version: 1,
    accounts,
    webcalSubscriptions,
    ...(settings ? { settings } : {}),
  }
  cachedConfig = config
  return config
}

/**
 * Reset cached config (for testing).
 */
export function resetConfigCache(): void {
  cachedConfig = undefined
}
