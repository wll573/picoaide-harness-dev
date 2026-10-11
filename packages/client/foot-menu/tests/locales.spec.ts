/**
 * 「更多」字典：zh 是 key 源，en 必须逐 key 镜像（项目惯例，见 account-card）。
 *
 * ---- 变异验证 ----
 *   - en 少一个 key（或写成空串）⇒ 对应用例红；
 *   - `setActiveLocale('en')` 后 `t()` 不换文案 ⇒「跟随语言」红。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { en, setActiveLocale, t, zh } from '../src/client/locales.ts'

afterEach(() => { setActiveLocale('zh') })

describe('foot-menu 字典', () => {
  it('en 与 zh 的 key 集合完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('没有空文案', () => {
    for (const [key, value] of Object.entries({ ...zh, ...en })) expect(value, key).not.toBe('')
  })

  it('zh 是 key 源（key 与取值一一对应，取值本身也是中文）', () => {
    // 「更多」行已随导航改造下线（六个入口直显，不再有折叠菜单），
    // `footMenu.label`/`labelAttention`/`more` 三个键随之删除 —— 留着它们会被
    // `i18n-keys.spec.ts` 的"无死键"守卫判红。本 spec 只验字典**机制**，
    // 因此拿仍在使用的那条（等待提示）当样本。
    expect(zh['footMenu.attention']).toContain('AI')
    expect(zh['footMenu.attention']).toContain('等待')
  })

  it('未要求时用中文，切到 en 后立刻换英文', () => {
    expect(t('footMenu.attention')).toBe('AI 正在等待你的操作')
    setActiveLocale('en')
    expect(t('footMenu.attention')).toBe('The AI is waiting for you')
  })

  it('区域化 locale id 按前缀判定（en-US 走英文），未知语言回落中文', () => {
    setActiveLocale('en-US')
    expect(t('footMenu.attention')).toBe('The AI is waiting for you')
    setActiveLocale('zh-Hans')
    expect(t('footMenu.attention')).toBe('AI 正在等待你的操作')
    setActiveLocale('fr')
    expect(t('footMenu.attention')).toBe('AI 正在等待你的操作')
  })
})
