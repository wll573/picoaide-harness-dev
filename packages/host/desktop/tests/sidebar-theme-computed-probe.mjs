/** Real Electron regression probe: node tests/sidebar-theme-computed-probe.mjs.
 * --mutate restores the old transparent default and must fail the paint checks.
 * Uses the production stylesheet, presenter and upstream sidebar/token CSS.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installAdvancedStyles } from '../src/client/styles.ts'
import { DesktopThemePresenter } from '../src/client/theme-presenter.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const client = join(root, 'deepseek-harness/packages/client')
const style = { dataset: {}, textContent: '', remove() {} }
globalThis.document = { createElement: () => style, head: { appendChild() {} } }
try { installAdvancedStyles() } finally { delete globalThis.document }
let styles = style.textContent
if (process.argv.includes('--mutate')) {
  styles = styles.replace(
    /\.dshDesktopSidebarSurface \{[^}]+\}/u,
    rule => rule.replaceAll('var(--dsw-alias-bg-base)', 'transparent'),
  )
}
const [tokens, sidebar] = await Promise.all([
  readFile(join(client, 'ui-theme/src/styles/design-platform.css'), 'utf8'),
  readFile(join(client, 'ui-sidebar/src/client/SidebarRoot.module.css'), 'utf8'),
])
const directory = await mkdtemp(join(tmpdir(), 'sidebar-theme-'))
const page = join(directory, 'probe.html')
await writeFile(page, `<!doctype html><html><head><meta charset="utf-8">
<style>${tokens}</style><style>${sidebar}</style><style>${styles}</style>
<style>.dshDesktopFrame { grid-template-columns: 280px 1fr; }
.root { gap: 24px; } h2 { font-size: 20px; } p { padding: 24px; }</style>
</head><body data-dsh-desktop-mode="advanced">
<div class="dshDesktopFrame" data-desktop-platform="win32">
<aside class="dshDesktopSidebarSurface"><div class="dshDesktopUpstreamSidebar">
<div class="root"><h2>Sidebar</h2><span>New conversation</span><span>Workspace</span>
<span>Settings</span></div></div></aside>
<main class="dshDesktopConversationSurface"><p>Conversation</p></main></div>
<div id="modal"></div><script>
const DesktopThemePresenter = ${DesktopThemePresenter.toString()};
const DARK_ATTRIBUTE = 'data-ds-dark-theme';
const presenter = new DesktopThemePresenter();
window.setState = (platform, scheme, collapsed, modal) => {
  presenter.apply({ active: { colorScheme: scheme, tokens: {} } });
  const frame = document.querySelector('.dshDesktopFrame');
  frame.dataset.desktopPlatform = platform;
  frame.toggleAttribute('data-sidebar-collapsed', collapsed);
  frame.style.gridTemplateColumns = (collapsed ? '56px' : '280px') + ' 1fr';
  document.querySelector('.root').classList.toggle('collapsed', collapsed);
  document.getElementById('modal').innerHTML = modal
    ? '<div role="dialog" aria-modal="true">Settings dialog</div>' : '';
  const surface = getComputedStyle(document.querySelector('.dshDesktopSidebarSurface'));
  const root = getComputedStyle(document.querySelector('.root'));
  return { platform, scheme, collapsed, modal,
    surface: surface.backgroundColor, root: root.backgroundColor, text: root.color,
    conversation: getComputedStyle(document.querySelector('main')).backgroundColor,
    nativeDark: matchMedia('(prefers-color-scheme: dark)').matches };
};
</script></body></html>`)

const electron = createRequire(import.meta.url)('electron')
const app = fileURLToPath(new URL('./sidebar-theme-probe-app.mjs', import.meta.url))
const args = [app, page, directory]
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY
const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
delete environment.ELECTRON_RUN_AS_NODE
const result = await new Promise((resolve, reject) => {
  const child = spawn(useXvfb ? 'xvfb-run' : electron, useXvfb ? ['-a', electron, ...args] : args,
    { env: environment, windowsHide: true })
  let output = ''
  let errors = ''
  const timer = setTimeout(() => { child.kill(); reject(new Error('Electron paint probe timed out')) }, 60_000)
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { errors += data })
  child.on('error', error => { clearTimeout(timer); reject(error) })
  child.on('close', code => { clearTimeout(timer); resolve({ code, output, errors }) })
})
assert.equal(result.code, 0, result.errors)
const measured = JSON.parse(result.output.split('\n').find(line => line.startsWith('SIDEBAR_RESULT ')).slice(15))
assert.equal(measured.length, 96)
const transparent = 'rgba(0, 0, 0, 0)'
for (const entry of measured) {
  const context = JSON.stringify(entry)
  assert.equal(entry.nativeDark, entry.nativeScheme === 'dark', context)
  if (entry.platform === 'darwin' && !entry.modal) {
    assert.equal(entry.surface, transparent, context)
    assert.equal(entry.root, transparent, context)
  } else {
    assert.notEqual(entry.surface, transparent, context)
    assert.equal(entry.surface, entry.conversation, context)
    assert.equal(entry.root, entry.conversation, context)
    assert.notEqual(entry.text, entry.surface, context)
  }
  assert.equal(entry.conversation, entry.scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 21, 23)', context)
}
await writeFile(join(directory, 'results.json'), JSON.stringify(measured, null, 2))
process.stdout.write(`SIDEBAR-THEME GREEN: ${measured.length}/${measured.length} scenarios\nScreenshots and measurements: ${directory}\n`)
