/** Hidden Electron renderer for sidebar-theme-computed-probe.mjs. */
import { app, BrowserWindow, nativeTheme } from 'electron'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [page, directory] = process.argv.slice(2)
app.setPath('userData', join(directory, 'user-data'))
app.on('window-all-closed', () => {})
app.disableHardwareAcceleration()
if (process.platform === 'linux' && process.getuid?.() === 0) app.commandLine.appendSwitch('no-sandbox')

async function screenshot(window, scheme) {
  await window.webContents.executeJavaScript(`window.setState('win32', '${scheme}', false, false)`)
  // Wait for layout and a complete paint before taking a frame; an immediately
  // delivered offscreen paint event may still carry the previous theme's image.
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const image = await window.webContents.capturePage()
  if (image.isEmpty()) throw new Error('Empty sidebar screenshot')
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const pixel = (x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
  const expected = scheme === 'light' ? [255, 255, 255, 255] : [23, 21, 21, 255]
  // The BGRA pixels prove the painted sidebar covers the black native backing.
  assert.deepEqual(pixel(20, height - 50), expected, `${scheme} sidebar paint`)
  assert.deepEqual(pixel(width - 50, height - 50), expected, `${scheme} conversation paint`)
  await writeFile(join(directory, `sidebar-${scheme}.png`), image.toPNG())
}

app.whenReady().then(async () => {
  const results = []
  // No Mica with a black native backing reproduces the affected machine's paint
  // path. The second window also checks the requested Mica configuration.
  for (const material of ['none', 'mica']) {
    const window = new BrowserWindow({ show: false, width: 1000, height: 700,
      backgroundColor: '#000000',
      ...(process.platform === 'win32' ? { backgroundMaterial: material } : {}),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true } })
    for (const nativeScheme of ['dark', 'light']) {
      nativeTheme.themeSource = nativeScheme
      await window.loadFile(page)
      for (const platform of ['win32', 'linux', 'darwin']) {
        // The return to light catches stale dark-theme state after a toggle.
        for (const scheme of ['light', 'dark']) {
          for (const collapsed of [false, true]) {
            for (const modal of [false, true]) {
              const state = await window.webContents.executeJavaScript(
                `window.setState(${JSON.stringify(platform)}, ${JSON.stringify(scheme)}, ${collapsed}, ${modal})`)
              results.push({ material, nativeScheme, ...state })
            }
          }
        }
      }
      await window.webContents.executeJavaScript("window.setState('win32', 'light', false, false)")
      if (material === 'none' && nativeScheme === 'dark') {
        await screenshot(window, 'light')
        await screenshot(window, 'dark')
      }
    }
    window.destroy()
  }
  process.stdout.write(`SIDEBAR_RESULT ${JSON.stringify(results)}\n`)
  app.exit(0)
}).catch(error => { process.stderr.write(`${error.stack}\n`); app.exit(1) })
