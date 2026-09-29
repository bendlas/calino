import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAllCredentials, saveCredentials, updateCredential } from '../credentials'
import { encryptPassword } from '@/lib/crypto'

const CREDENTIALS_KEY = 'calino_caldav_credentials'

function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>()
  const localStorageMock = {
    getItem: (key: string): string | null => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string): void => {
      map.set(key, String(value))
    },
    removeItem: (key: string): void => {
      map.delete(key)
    },
    clear: (): void => map.clear(),
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    get length(): number {
      return map.size
    },
  }
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
  return map
}

function readStored(map: Map<string, string>): Record<string, unknown>[] {
  return JSON.parse(map.get(CREDENTIALS_KEY) ?? '[]')
}

describe('credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Bug 36: JSON.parse failure warnings', () => {
    it('logs a warning when stored credentials are corrupted JSON', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const localStorageMock = {
        getItem: vi.fn().mockReturnValue('not-valid-json{{'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toEqual([])
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('[CalDAV]')
      expect(warnSpy.mock.calls[0][0]).toContain('credentials')
      expect(warnSpy.mock.calls[0][0]).toContain('Failed to parse')

      warnSpy.mockRestore()
    })

    it('returns empty array when localStorage is empty', async () => {
      const localStorageMock = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toEqual([])
    })

    it('returns parsed credentials when JSON is valid', async () => {
      const validData = JSON.stringify([
        { id: '1', serverUrl: 'https://example.com', username: 'user', password: 'pass' },
      ])
      const localStorageMock = {
        getItem: vi.fn().mockReturnValue(validData),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      }
      Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })
      Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

      const result = await getAllCredentials()

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('1')
    })
  })

  describe('browser-session accounts never persist a password', () => {
    let map: Map<string, string>

    beforeEach(() => {
      map = installLocalStorage()
    })

    it('omits the password field when saving a browser-session credential', async () => {
      await saveCredentials({
        serverUrl: 'https://calendar.example.com/caldav.php/chair/calendar',
        username: '',
        password: '',
        authMode: 'browser-session',
      })

      const [stored] = readStored(map)
      expect(stored.authMode).toBe('browser-session')
      expect(stored).not.toHaveProperty('password')

      const [credential] = await getAllCredentials()
      expect(credential.password).toBe('')
    })

    it('drops a stored Basic password when switching to browser-session', async () => {
      const saved = await saveCredentials({
        serverUrl: 'https://example.com',
        username: 'user',
        password: 'hunter2',
        authMode: 'basic',
      })
      expect(readStored(map)[0]).toHaveProperty('password')

      await updateCredential(saved.id, { authMode: 'browser-session' })

      const [stored] = readStored(map)
      expect(stored.authMode).toBe('browser-session')
      expect(stored).not.toHaveProperty('password')
      const [credential] = await getAllCredentials()
      expect(credential.password).toBe('')
    })

    it('purges a leftover password blob on next read (migration)', async () => {
      map.set(
        CREDENTIALS_KEY,
        JSON.stringify([
          {
            id: 'legacy',
            serverUrl: 'https://example.com',
            username: 'user',
            authMode: 'browser-session',
            password: await encryptPassword('leftover-secret'),
          },
        ])
      )

      const [credential] = await getAllCredentials()
      expect(credential.password).toBe('')

      const [stored] = readStored(map)
      expect(stored).not.toHaveProperty('password')
    })

    it('keeps the Basic password when an unrelated field changes', async () => {
      const saved = await saveCredentials({
        serverUrl: 'https://example.com',
        username: 'user',
        password: 'hunter2',
        authMode: 'basic',
      })

      await updateCredential(saved.id, { username: 'renamed' })

      const [stored] = readStored(map)
      expect(stored.username).toBe('renamed')
      expect(stored).toHaveProperty('password')
      const [credential] = await getAllCredentials()
      expect(credential.password).toBe('hunter2')
    })
  })
})
