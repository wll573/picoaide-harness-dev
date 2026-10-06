import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionService, { SESSION_CHANGED_EVENT } from '../src/session-service.ts'

vi.mock('../src/server-connector/electron.ts', () => ({ loadElectronModule: async () => ({ safeStorage: { isEncryptionAvailable: () => false } }) }))
const dirs: string[] = []
const sample = { serverURL: 'https://harness.example.com', username: 'alice', token: 'test-token' }
function harness(matches = false, badPath = false) {
  const dir = mkdtempSync(join(tmpdir(), 'session-account-data-')); dirs.push(dir)
  const file = join(dir, ...(badPath ? ['missing', 'session.json'] : ['session.json']))
  const emit = vi.fn()
  const activate = vi.fn(async () => {
    expect(JSON.parse(readFileSync(file, 'utf8')).username).toBe(sample.username)
  })
  const scope = { matches: () => matches, activate }
  const ctx = {
    emit, get: () => scope, reflect: { provide: vi.fn() }, on: vi.fn(() => () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Context
  const service = new SessionService(ctx, { tokenFile: file, lastServerFile: join(dir, 'last-server.json') })
  return { service, emit, activate }
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('session activation and account data', () => {
  it('persists and restarts before publishing an account into another account data scope', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.service.isRestored()).toBe(true))
    await h.service.setSession(sample)
    expect(h.activate).toHaveBeenCalledWith(sample)
    expect(h.service.isLoggedIn()).toBe(false)
    expect(h.service.getSession()).toBeNull()
    expect(h.emit).not.toHaveBeenCalledWith(SESSION_CHANGED_EVENT, sample)
  })

  it('activates normally when the process already owns this account data', async () => {
    const h = harness(true)
    await vi.waitFor(() => expect(h.service.isRestored()).toBe(true))
    await h.service.setSession(sample)
    expect(h.service.getSession()).toEqual(sample)
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.emit).toHaveBeenCalledWith(SESSION_CHANGED_EVENT, sample)
  })

  it('rejects a failed token write without exposing either account or restarting', async () => {
    const h = harness(false, true)
    await vi.waitFor(() => expect(h.service.isRestored()).toBe(true))
    await expect(h.service.setSession(sample)).rejects.toThrow()
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.service.getSession()).toBeNull()
  })

  it('cancels an in-flight account switch on logout and does not revive its token', async () => {
    const h = harness()
    await vi.waitFor(() => expect(h.service.isRestored()).toBe(true))
    const pending = h.service.setSession(sample)
    const concurrent = h.service.setSession({ ...sample, username: 'bob' })
    h.service.clear()
    await expect(concurrent).rejects.toThrow('already in progress')
    await pending
    expect(h.activate).not.toHaveBeenCalled()
    expect(h.service.isLoggedIn()).toBe(false)
  })
})
