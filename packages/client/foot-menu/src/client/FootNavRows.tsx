/**
 * 侧边栏底部的**一级导航行**（原先是一个「更多」行 + 向上浮层）。
 *
 * ## 它替代了什么
 *
 * 两轮改造的历史刚好相反，两次都值得记住：
 *
 *   ① 最初五个插件各自往 `sidebar.footer.action` 注册一整行（定时任务 / 能力中心 /
 *      连接器 / 浏览器 / 应用中心），底部固定占掉约 210px；
 *   ② 2026-09-21 并道成**一个**「更多」行 + 浮层，把五项收进二级菜单；
 *   ③ 现在（内网交付口径，2026-10）改回**逐行直显**：五个入口与「设置」同级，
 *      但几何**显著收窄**（height 28 / padding 收窄 / 间距缩短），所以底部占用
 *      远小于 ① 的 210px，同时不再需要先展开才能点到。
 *
 * 条目仍全部经 `picoFootMenu` 服务收集（见 `contract.ts`）—— 所以这次改造
 * **五个插件的登记代码一行都不用动**，只有本包的渲染方式变了。这也是当初把
 * 条目做成「跨 bundle 传数据」而不是「各自注册槽位」的回报。
 *
 * ## 两个容易踩的点
 *
 * 1. **不写行内 `background`**：行内样式优先级高于注入的 `.pico-foot-nav-row:hover`
 *    规则，写进去 hover 就永远是死的（2026-09-21 与账户行走查发现同一坑）。
 *    透明底与 hover 底都进注入的样式表（见 `index.ts`）。
 * 2. **激活态文案要与「设置」行同构**：面板激活时该行加粗并显示 `✓`，与
 *    `ui-settings-general` 的设置行保持同一层级语言。面板**关闭只删属性、不发事件**，
 *    所以必须用 `MutationObserver` 观察 `PANEL_ACTIVE_ATTR`，不能只听
 *    `PANEL_ACTIVATE_EVENT`。
 *
 * @module @picoaide/dsh-foot-menu/client/FootNavRows
 */

import { useEffect, useReducer, useState, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PANEL_ACTIVE_ATTR, activePanelId } from '@picoaide/dsh-panel-surface/client'
import { currentFootMenuService, type FootMenuEntry } from './contract.ts'
import { CHECK_GLYPH, FootMenuGlyph } from './glyphs.tsx'
import { t } from './locales.ts'

/**
 * 宽栏几何。比并入前的那五行更紧（height 34 → 28、`padding` 6/2/6/10 → 4/2/4/8、
 * 垂直外边距 4px → 1px），这是需求「缩小入口宽度和内边距、缩短入口之间的间距、
 * 让对话区拿到更多宽度」的落点。
 *
 * 与账户卡（`account-card` 的 `AccountCard.tsx`）保持同一套取值：两者同处底部
 * 固定区，差 2px 就会在视觉上明显错位。
 */
const ROW_WIDE: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'calc(100% + 8px)',
  height: 28,
  margin: '1px -4px',
  padding: '4px 2px 4px 8px',
  boxSizing: 'border-box',
  border: 'none',
  borderRadius: 8,
  // **不写 `background`**：见文件头第 1 点。
  cursor: 'pointer',
  overflow: 'hidden',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
}

/** 窄轨（56px rail）：28×28 圆按钮，无文字。 */
const ROW_RAIL: CSSProperties = {
  ...ROW_WIDE,
  width: 28,
  height: 28,
  margin: '1px 0',
  justifyContent: 'center',
  gap: 0,
  padding: 0,
  borderRadius: '50%',
}

/** 行文案：吃满中间空间，尾部留给激活标记。 */
const ROW_LABEL: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  textAlign: 'left',
}

/** 警示态配色（与浏览器插件原本的"AI 在等你"同一取值）。 */
const WAITING_COLOR = '#d97706'

/** 行上的警示圆点（窄轨也要看得见 —— 那里没有文字位）。 */
const WAITING_DOT: CSSProperties = {
  position: 'absolute',
  top: 3,
  right: 3,
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: WAITING_COLOR,
  pointerEvents: 'none',
}

/** 没有条目时的稳定空快照（避免每次渲染都新建数组）。 */
const NO_ENTRIES: readonly FootMenuEntry[] = []

/**
 * 侧边栏底部的导航行集合。
 *
 * 条目为 0 时整体渲染 `null` —— 与外壳「没有注册就不占位、也不留间距」的约定一致
 * （见 `ui-sidebar` 对 `sidebar.panellist` 的同款说明）。
 * @param props - 侧边栏底部槽位给出的列宽状态（`wide=false` 即 56px 窄轨）。
 * @returns 若干行；无条目时为 `null`。
 */
export function FootNavRows(props: PropsRuntime<'sidebar.footer.action'>): JSX.Element | null {
  const service = currentFootMenuService()
  const wide = props.wide === true
  const [, forceRender] = useReducer((count: number) => count + 1, 0)
  const [active, setActive] = useState<string | null>(() => (typeof document === 'undefined' ? null : activePanelId(document)))

  // 每次渲染都重新取快照并**重新求值** title()/attention()：这两个取值是函数，
  // 语言切换与轮询结果都靠"渲染时读取"生效（`touch()` 负责把变化推过来）。
  const entries = service === undefined ? NO_ENTRIES : service.snapshot()

  // 来源①：登记表发布（登记/注销/touch）。
  useEffect(() => {
    if (service === undefined) return undefined
    return service.subscribe(() => { forceRender() })
  }, [service])

  // 来源②：面板激活态属性。面板**关闭只删属性、不发事件**，所以必须观察属性变化。
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const read = (): void => { setActive(activePanelId(document)) }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [PANEL_ACTIVE_ATTR] })
    return () => { observer.disconnect() }
  }, [])

  if (service === undefined || entries.length === 0) return null

  return (
    <>
      {entries.map((entry) => {
        const isActive = entry.id === active
        const waiting = entry.attention?.() === true
        // 警示文案：条目自己给的可操作句子优先，没有才退回通用那句
        // （浏览器那条要把用户指到浏览器窗口的「交给 AI」按钮）。
        const waitingTitle = waiting ? entry.attentionTitle?.() ?? t('footMenu.attention') : undefined
        const label = entry.title()
        const accessibleLabel = waiting ? `${label}（${waitingTitle}）` : label
        return (
          <button
            key={entry.id}
            type="button"
            className="pico-foot-nav-row"
            aria-current={isActive ? 'true' : undefined}
            aria-label={accessibleLabel}
            title={waitingTitle ?? label}
            style={{
              ...(wide ? ROW_WIDE : ROW_RAIL),
              position: 'relative',
              // 激活态用中性强调色 + 加粗（与设置行同一层级的语言），
              // 不用复选框式的 ✓ 独占一个图标位 —— 窄轨里没有那个空间。
              ...(isActive ? { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } : null),
              ...(waiting ? { color: WAITING_COLOR } : null),
            }}
            onClick={() => { entry.activate() }}
          >
            {isActive
              ? <FootMenuGlyph glyph={CHECK_GLYPH} size={wide ? 14 : 16} />
              : <FootMenuGlyph id={entry.id} size={wide ? 14 : 16} />}
            {wide && <span style={ROW_LABEL}>{label}</span>}
            {waiting && <span style={WAITING_DOT} data-role="foot-menu-attention" aria-hidden="true" />}
          </button>
        )
      })}
    </>
  )
}
