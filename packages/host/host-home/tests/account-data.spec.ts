import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountDataIdentity, accountDataRoot, createAccountDataScope } from '../src/account-data.ts'

const homes: string[] = []
function home() { const dir = mkdtempSync(join(tmpdir(), 'account-data-')); homes.push(dir); return dir }
const alice = { serverURL: 'https://harness.example.com', username: 'alice' }
const bob = { ...alice, username: 'bob' }
afterEach(() => { for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('account data isolation', () => {
  it('separates users and servers and canonicalizes server spelling', () => {
    const dir = home()
    expect(accountDataRoot(dir, alice)).not.toBe(accountDataRoot(dir, bob))
    expect(accountDataRoot(dir, alice)).not.toBe(accountDataRoot(dir, { ...alice, serverURL: 'https://other.example.com' }))
    expect(accountDataRoot(dir, alice)).toBe(accountDataRoot(dir, { ...alice, serverURL: 'https://HARNESS.example.com:443/' }))
    expect(accountDataRoot(dir, { ...bob, username: '../../alice' })).toMatch(/[\\/]accounts[\\/][a-f0-9]{64}$/)
  })

  it('starts without access to legacy data and switches only on a fresh process', async () => {
    const dir = home()
    const restart = vi.fn(async () => {})
    const first = createAccountDataScope(dir, restart)
    expect(first.root).toBe(join(dir, 'accounts', 'signed-out'))
    expect(first.matches(alice)).toBe(false)
    await first.activate(alice)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(first.matches(alice)).toBe(false)
    const next = createAccountDataScope(dir, restart)
    expect(next.matches(alice)).toBe(true)
    expect(next.matches(bob)).toBe(false)
    expect(next.root).toBe(accountDataRoot(dir, alice))
    await next.activate(bob)
    const back = createAccountDataScope(dir, restart)
    expect(back.matches(bob)).toBe(true)
    expect(next.matches(bob)).toBe(false)
  })

  it('fails closed on a corrupt selector and never assigns old shared records to a new account', () => {
    const dir = home()
    writeFileSync(join(dir, 'account-data.json'), '{broken')
    writeFileSync(join(dir, 'legacy-record.txt'), 'old account record')
    const scope = createAccountDataScope(dir, async () => {})
    expect(scope.matches(alice)).toBe(false)
    expect(scope.root).toBe(join(dir, 'accounts', 'signed-out'))
    expect(readFileSync(join(dir, 'legacy-record.txt'), 'utf8')).toBe('old account record')
    expect(accountDataIdentity(alice)).not.toContain('token')
  })
})
