/** Account-owned conversation data; credentials and installation settings stay in the installation home. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ACCOUNT_DATA_SCOPE_SERVICE = 'desktopAccountData'
export interface AccountDataIdentityInput { serverURL: string; username: string }
export interface AccountDataScope {
  readonly root: string
  matches(account: AccountDataIdentityInput): boolean
  /** Select the account for the next process; this process keeps its original scope. */
  activate(account: AccountDataIdentityInput): Promise<void>
}

export function accountDataIdentity(account: AccountDataIdentityInput): string {
  if (!account.username) throw new Error('account data requires a username')
  const url = new URL(account.serverURL.trim())
  url.hash = ''
  return JSON.stringify([url.toString().replace(/\/+$/u, ''), account.username])
}

export function accountDataRoot(home: string, account: AccountDataIdentityInput): string {
  return rootForIdentity(home, accountDataIdentity(account))
}

function rootForIdentity(home: string, identity: string): string {
  return join(home, 'accounts', identity === '' ? 'signed-out' : createHash('sha256').update(identity).digest('hex'))
}

function selectedIdentity(home: string): string {
  try {
    const value = JSON.parse(readFileSync(join(home, 'account-data.json'), 'utf8')) as AccountDataIdentityInput
    if (typeof value.serverURL !== 'string' || typeof value.username !== 'string' || !value.username) return ''
    return accountDataIdentity(value)
  } catch { return '' }
}

/** Never adopt the old shared sessions/storages automatically: their owner is unknown. */
export function createAccountDataScope(home: string, restart: () => Promise<void>): AccountDataScope {
  const identity = selectedIdentity(home)
  return {
    root: rootForIdentity(home, identity),
    matches: account => identity === accountDataIdentity(account),
    activate: async account => {
      accountDataIdentity(account) // Validate before changing any files.
      mkdirSync(home, { recursive: true, mode: 0o700 })
      const temporary = join(home, `.account-data-${randomUUID()}.tmp`)
      try {
        writeFileSync(temporary, JSON.stringify({ serverURL: account.serverURL, username: account.username }), { mode: 0o600 })
        renameSync(temporary, join(home, 'account-data.json'))
      } finally { rmSync(temporary, { force: true }) }
      await restart()
    },
  }
}
