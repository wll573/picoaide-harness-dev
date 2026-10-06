import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { accountDataRoot, createAccountDataScope } from '../src/desktop-home.ts'
import { prepareDesktopProfile, desktopProfileContext } from '../src/profile.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('pins conversations and indexes to the same account above installation overrides', async () => {
  const home = mkdtempSync(join(tmpdir(), 'profile-account-')); dirs.push(home)
  const account = { serverURL: 'https://harness.example.com', username: 'alice' }
  await createAccountDataScope(home, async () => {}).activate(account)
  writeFileSync(join(home, 'cordis.patch.yml'), '- id: storage-json\n  config:\n    root: shared-data\n')
  const profile = await prepareDesktopProfile(undefined, home, 'win32')
  const entries = composeEntries([profile.patches])
  const root = accountDataRoot(home, account)
  expect(entries.find(row => row.id === 'session-persistence-jsonl')?.config).toMatchObject({ root: join(root, 'sessions') })
  expect(entries.find(row => row.id === 'storage-json')?.config).toMatchObject({ root: join(root, 'storages') })
  expect(desktopProfileContext(profile).overlays).toContainEqual(expect.objectContaining({ id: 'storage-json', config: expect.objectContaining({ root: join(root, 'storages') }) }))
})

it('wires the fixed scope into both profile preparation and the session service before boot', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  expect(main).toContain('const accountData = createAccountDataScope(homeDir, () => runtime.requestRestart())')
  expect(main).toMatch(/prepareDesktopProfile\([\s\S]*?accountData\.root,/u)
  expect(main).toContain('hostCtx.provide(ACCOUNT_DATA_SCOPE_SERVICE, accountData)')
})
