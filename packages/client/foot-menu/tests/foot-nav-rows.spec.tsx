// @vitest-environment jsdom
/**
 * **组合**判据：真导航行（`FootNavRows`）+ 真装载器（`mountPanelSurface`）。
 *
 * 这条覆盖原先由 `panel-focus-handoff.spec.tsx`（配合已被删除的 `FootMenuRow` 浮层）
 * 承担；2026-10 改回「逐行直显」后，按新形态重建在**新文件名**下（旧名不再复用，
 * 免得文档里的引用指到两个不同的东西）。
 *
 * 为什么单包用例证明不了它（2026-09-25 审计 FIX-29 P2）：
 *   · `foot-menu` 自己的用例要么用**替身** `activate`（根本不移动焦点），要么只断言
 *     "渲染出了什么"，于是"点条目后焦点回到触发行"很容易被写成契约 —— 而真实组合里
 *     装载器 `activate()` 会把焦点移进面板；触发方再多手 `focus()` 一次锚点，焦点就
 *     被抢回侧边栏，键盘用户 Tab 不进面板；
 *   · `panel-surface` 自己的用例覆盖"互斥 / Esc / dispose"与"激活聚焦容器"，却证明不了
 *     **侧边栏这一侧**接没接上（`container.focus()` 那一行删掉它照样自洽）。
 * 所以判据必须把两半接起来跑：点真导航行 ⇒ 焦点在面板里；Esc ⇒ 面板关掉且焦点回到
 * **常驻**的那一行。
 *
 * 与旧浮层形态的差别（**不要照抄旧期望**）：行是常驻元素，不再是"随浮层关闭而消失的
 * 条目按钮"。`activate()` 之前 `document.activeElement` 就是被点的那一行，所以装载器
 * 的归还目标就是它自己 —— 回归断言自然是"焦点回到被点的行"。
 *
 * ---- 变异验证 ----
 *   - `FootNavRows` 的 `onClick` 在 `entry.activate()` 之后补一句
 *     `event.currentTarget.focus()`（把焦点从刚打开的面板里抢回来）⇒
 *     「点某一行打开面板：焦点进入面板容器」红；
 *   - `surface.tsx` 的 `container?.focus(...)` 删掉 ⇒ 同上红；
 *   - `surface.tsx` 的 `closeAndMaybeRestoreFocus` 不归还焦点 ⇒「Esc 关闭面板」红；
 *   - `FootNavRows` 不订阅登记表 / 不 `forceRender` ⇒「登记表驱动渲染」红；
 *   - 快照不按 `order` 排序（或丢掉 tie 保序）⇒「登记表驱动渲染」的顺序断言红；
 *   - 窄轨分支把文案 `span` 也渲染出来 ⇒「窄轨（wide=false）」红；
 *   - `attention()` 判据写死 `false`、或去掉圆点 ⇒「警示态」红。
 *
 * 导入走 `vitest.config.ts` 的 alias 指向 `panel-surface` 的**源码**：判据必须咬住源码，
 * 而不是 `lib/` 里可能过期的构建产物（否则上面第二、三条变异会被旧产物挡住，用例假绿）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  PANEL_ACTIVE_ATTR,
  PANEL_SURFACE_ATTR,
  mountPanelSurface,
  type PanelSurfaceHandle,
} from '@picoaide/dsh-panel-surface/client'
import { createFootMenuService, installFootMenu, type FootMenuService } from '../src/client/contract.ts'
import { FootNavRows } from '../src/client/FootNavRows.tsx'
import { setActiveLocale } from '../src/client/locales.ts'

// React 18 的 `act` 需要这个全局标志，否则每条用例都会打一遍
// "The current testing environment is not configured to support act(...)"。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let column: HTMLDivElement
let root: Root
let surface: PanelSurfaceHandle
let service: FootMenuService
let uninstall: () => void

/** 当下 DOM 里的全部导航行（按渲染顺序）。 */
const rows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.pico-foot-nav-row')]

/**
 * 按文案定位一行。
 *
 * 只在**非警示态**上用：`attention()` 为真时 `aria-label` 会被改写成
 * `标题（可操作的那句）`（见 `FootNavRows` 的 `accessibleLabel`），那时改用行内的
 * 圆点定位（见「警示态」用例）。
 */
const rowByLabel = (label: string): HTMLButtonElement => {
  const button = rows().find(item => item.textContent === label || item.getAttribute('aria-label') === label)
  if (button === undefined) throw new Error(`没有找到文案为「${label}」的导航行`)
  return button
}

/** 面板容器（装载器插进中列的那一层）。 */
const panelContainer = (id: string): HTMLElement | null =>
  column.querySelector<HTMLElement>(`[${PANEL_SURFACE_ATTR}="${id}"]`)

/** 渲染导航行（`wide=false` 即 56px 窄轨）。 */
async function renderRows(wide: boolean): Promise<void> {
  await act(async () => { root.render(<FootNavRows wide={wide} />) })
}

/**
 * 真交互路径：先把焦点放到那一行，再派发 click。
 *
 * 先 `focus()` 是必要的 —— jsdom 不实现"按下鼠标就给元素焦点"的默认行为，而装载器的
 * 归还目标正是 `activate()` 那一刻的 `document.activeElement`。
 */
async function clickRow(label: string): Promise<void> {
  const button = rowByLabel(label)
  await act(async () => {
    button.focus()
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(async () => {
  setActiveLocale('zh')
  document.documentElement.removeAttribute(PANEL_ACTIVE_ATTR)
  document.body.innerHTML = ''
  // 中列的形态就是桌面壳里的那一层（装载器只认它）。
  column = document.createElement('div')
  column.className = 'dshDesktopConversationSurface'
  document.body.appendChild(column)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  // 真装载器：条目点开的那个面板就是它。
  await act(async () => {
    surface = mountPanelSurface({ id: 'cron', render: () => <div data-testid="cron-body">定时任务</div> })
  })

  // 真登记表（不是替身登记表：替身会让"注册了但渲染不出来"这类缺陷溜过去）。
  service = createFootMenuService()
  uninstall = installFootMenu({ provide: () => undefined } as unknown as Context, service)
  service.add({ id: 'cron', order: -10, title: () => '定时任务', activate: () => { surface.activate() } })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  // 装载器自己也持有一个 React root，并且观察 `document.body` 的 childList：dispose 与
  // 摘除节点若在 act 之外做，它会在每一条用例收尾时抛一串 "update to Root ... not
  // wrapped in act" —— 那是真噪声（它确实在渲染），不是可以无视的告警。
  await act(async () => { surface.dispose() })
  uninstall()
  await act(async () => {
    container.remove()
    column.remove()
  })
  document.documentElement.removeAttribute(PANEL_ACTIVE_ATTR)
})

describe('底部导航行：登记表驱动渲染与面板焦点交接', () => {
  it('登记表驱动渲染：行数取自快照、文案取 title()、顺序按 order（注销后跟着少一行）', async () => {
    service.add({ id: 'apps', order: 2, title: () => '应用中心', activate: () => undefined })
    const off = service.add({ id: 'connectors', order: 0, title: () => '连接器', activate: () => undefined })
    service.add({ id: 'capability', order: -1, title: () => '能力中心', activate: () => undefined })
    await renderRows(true)

    expect(rows().map(item => item.textContent)).toEqual(['定时任务', '能力中心', '连接器', '应用中心'])

    // 注销后必须**重新发布**到已渲染的行上：订阅没接上这里就会留下幽灵行。
    off()
    await act(async () => { service.touch() })
    expect(rows().map(item => item.textContent)).toEqual(['定时任务', '能力中心', '应用中心'])
  })

  it('点某一行打开面板：焦点进入面板容器（跨包交接，不被行抢回）', async () => {
    await renderRows(true)
    await clickRow('定时任务')

    expect(document.documentElement.getAttribute(PANEL_ACTIVE_ATTR)).toBe('cron')
    expect(document.querySelector('[data-testid="cron-body"]')?.textContent).toBe('定时任务')
    expect(document.activeElement, '焦点必须落在面板容器上，而不是被导航行抢回去').toBe(panelContainer('cron'))
  })

  it('Esc 关闭面板：面板关掉、内容卸载，焦点归还给常驻的那一行', async () => {
    await renderRows(true)
    await clickRow('定时任务')
    expect(document.activeElement).toBe(panelContainer('cron'))

    // 真键盘路径：从**获得焦点的元素**上冒泡（装载器的 Esc 监听在 document 冒泡阶段）。
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })

    expect(document.documentElement.getAttribute(PANEL_ACTIVE_ATTR)).toBeNull()
    expect(document.querySelector('[data-testid="cron-body"]')).toBeNull()
    expect(document.activeElement, '归还目标必须是常驻的导航行本身').toBe(rowByLabel('定时任务'))
  })

  it('窄轨（wide=false）：渲染成无文字的按钮，仍可点开面板并交接焦点', async () => {
    await renderRows(false)
    const button = rowByLabel('定时任务')
    expect(button.textContent, '窄轨没有文字位').toBe('')
    expect(button.querySelector('span')).toBeNull()

    await clickRow('定时任务')
    expect(document.documentElement.getAttribute(PANEL_ACTIVE_ATTR)).toBe('cron')
    expect(document.activeElement).toBe(panelContainer('cron'))
  })

  it('警示态：attention() 为真时行上出现警示圆点（宽栏与窄轨都看得见）', async () => {
    service.add({
      id: 'browser',
      order: 1,
      title: () => '浏览器',
      activate: () => undefined,
      attention: () => true,
      attentionTitle: () => '打开浏览器窗口点「交给 AI」',
    })
    await renderRows(true)

    expect(rowByLabel('定时任务').querySelector('[data-role="foot-menu-attention"]'), '不在等待的行没有圆点').toBeNull()
    const waiting = rows().find(item => item.querySelector('[data-role="foot-menu-attention"]') !== null)
    expect(waiting, '等待中的条目必须出现警示圆点').toBeDefined()
    expect(waiting!.textContent).toBe('浏览器')
    expect(waiting!.getAttribute('aria-label'), '警示态的 aria-label 要带上条目给的可操作那句')
      .toBe('浏览器（打开浏览器窗口点「交给 AI」）')

    // 窄轨里没有文字位，圆点是唯一的可见信号 —— 少了它用户看不到"AI 在等你"。
    await renderRows(false)
    const railWaiting = rows().find(item => item.querySelector('[data-role="foot-menu-attention"]') !== null)
    expect(railWaiting, '窄轨也要看得见警示圆点').toBeDefined()
    expect(railWaiting!.textContent).toBe('')
  })
})
