# @picoaide/dsh-foot-menu

侧边栏底部的**一级导航行**（条目来自一张跨 bundle 的登记表）。它本身不拥有任何面板、路由或数据面，
只拥有"底部功能区的一个座位"和那张**登记表**。

```
宽栏常驻
┌──────────────────┐
│ ⏱ 定时任务        │
│ ✦ 能力中心        │
│ ⧉ 连接器          │
│ ◎ 浏览器          │
│ ▦ 应用中心        │
│ ⚙ 设置            │
│ U user            │
└──────────────────┘
```

## 它替代了什么（两轮相反的改造）

| 时期 | 形态 | 底部占用 |
| --- | --- | --- |
| 最初 | 五个插件各自注册**一整行** | 约 210px |
| 2026-09-21 | 并道成**一个**「更多」行 + 向上浮层 | 一行，但要展开才能点到 |
| 现在（内网交付） | 改回**逐行直显**，几何收窄 | 远小于最初（行高 28、间距 1px） |

第三轮能低成本落地，是因为条目走的是 `picoFootMenu` 服务而不是各自注册槽位 ——
**五个插件的登记代码三轮都没动过**，只有本包的渲染方式变了。

## 契约

客户端半边提供 Cordis 服务 `picoFootMenu`（`ctx.provide('picoFootMenu', …)`）：

```ts
interface FootMenuEntry {
  id: string                                   // 打开面板的条目必须等于 panel-surface 的 PanelId
  order: number                                // 升序；相同 order 保登记序
  title: () => string                          // 渲染时读取（语言切换后跟着变）
  activate: () => void                         // 点击要做的事
  attention?: (() => boolean) | undefined      // true ⇒ 行上圆点 + 条目琥珀色
  attentionTitle?: (() => string) | undefined  // 警示 tooltip / aria-label（可操作的那句）
}
interface FootMenuService {
  add(entry: FootMenuEntry): () => void        // 返回**幂等**注销函数
  touch(): void                                // 动态取值（如 attention）变化后重新发布
  snapshot(): readonly FootMenuEntry[]         // 按 order 排序；未变时返回同一引用
  subscribe(listener: () => void): () => void
}
```

消费者：用 `import type {} from '@picoaide/dsh-foot-menu/client'` 取类型（**绝不**运行时
import 本包），并且**不要**把 `'picoFootMenu'` 写进自己的 `inject`：提供它的这一行可以被
渠道覆盖层 / `$DSH_HOME/cordis.patch.yml` 禁用，硬 inject 会让整条 fiber 永久 pending
（无报错）。条目从**子 fiber** 登记，只有它等服务到位：

```ts
ctx.inject(['picoFootMenu'], (scope: ClientContext) => {
  scope.effect(() => scope.picoFootMenu.add({ id, order, title, activate, attention, attentionTitle }),
    '<pkg>: foot menu entry')
})
```

警示文案分两层：`footMenu.attention`（通用："AI 正在等待你的操作"）是兜底，
`attentionTitle()` 是条目自己给的**可操作**那句（浏览器的"打开浏览器窗口点「交给 AI」"）——
两者都进该行的 tooltip 与 `aria-label`。警示行同时显示琥珀色圆点（窄轨里也看得见）。

## 为什么是服务，而不是槽位

槽位 list 能把多个占用者排成多行、每个占用者自己拥有几何；但条目要跨 bundle 传递
（每个插件是一个独立的客户端 bundle），而客户端 Cordis 服务是跨 bundle 的**唯一**通道：
`@picoaide/dsh-panel-surface` 会被内联进每个 bundle，模块级单例在浏览器里根本不是同一份。

ReactNode 不过界：条目只带数据，图标由本包的 glyph 表按 `id` 提供（未登记的 id 走兜底图形）。

## 实现要点

- **一个槽位占用者渲染全部行**：`sidebar.footer.action` 仍是"一个占用者"（`pico-foot-menu`），
  它把登记表快照渲染成若干 `<button>`。槽位的"多占用者"能力在这里用不上 —— 条目来自登记表，
  不是槽位。
- **不写行内 `background`**：行内样式优先级高于注入的 `.pico-foot-nav-row:hover` 规则，
  写进去 hover 就永远是死的。透明底与 hover 底都进注入的样式表（见 `client/index.ts`）。
- **激活态**读 `panel-surface` 的唯一激活态属性；面板关闭只删属性、不发事件，
  所以必须用 `MutationObserver`，不能只听 `PANEL_ACTIVATE_EVENT`。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 宿主半边：no-op（本包无路由/数据面，只是客户端 bundle 载体） |
| `src/client/contract.ts` | 服务契约 + `declare module '@deepseek-ai/cordis'` + 登记表实现 |
| `src/client/FootNavRows.tsx` | 一级导航行（按登记表快照逐行渲染） |
| `src/client/glyphs.tsx` | 五个面板图标（自被替换的 trigger 逐字搬来）+ ✓/兜底 |
| `src/client/locales.ts` | zh（key 源）+ en 镜像 |
| `src/client/index.ts` | 字典 + 提供 `picoFootMenu` + 注册唯一槽位占用者 |
