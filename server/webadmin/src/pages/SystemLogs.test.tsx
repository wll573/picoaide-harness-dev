import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { request } from '../api'
import SystemLogs, { SENSITIVE_ACTION_LABEL } from './SystemLogs'

// ---------------------------------------------------------------------------
// 系统日志页（需求 §8.1）的组件级用例。
//
// 这份用例照 `Audit.test.tsx` 的 mock 手法做（真组件 + mock 网络层），覆盖：
//   ① 正常列表渲染（系统事件中文标签、操作者、详情、时间）；
//   ② 筛选（按操作下拉 / 按操作者 Enter）；
//   ③ 导出 CSV（真的触发一次下载；公式注入前缀 + UTF-8 BOM；文件名）；
//   ④ 分页（页码/总数、上一页/下一页的边界与请求参数）。
//
// 断言口径：读**渲染结果**而不是"发过请求"（`waitForRows`），并在导出前等数据行
// 落地 —— 导出读的是组件 state，提前点只会拿到空表（`Audit.test.tsx` 2026-09-17
// Gate 红过一次的那个坑）。
// ---------------------------------------------------------------------------

const mockRequest = vi.mocked(request)

/** 混进用户名里的公式注入载荷（登录失败会把请求里的用户名原样写进审计行）。 */
const EVIL_DDE = "=cmd|'/C calc'!A0"

// 系统事件样本：登录/登出、管理员自助、普通管理操作各一条，外加一条注入载荷。
const LOGS = [
  { id: 1, username: 'alice', action: 'login_success', detail: 'ip=10.0.0.9', created_at: '2026-10-02T09:00:00+08:00' },
  { id: 2, username: 'mallory', action: 'login_fail', detail: 'ip=10.0.0.9', created_at: '2026-10-02T09:00:01+08:00' },
  { id: 3, username: 'root', action: 'password_change', detail: 'self-service', created_at: '2026-10-02T09:00:02+08:00' },
  { id: 4, username: 'admin', action: 'gateway_config', detail: 'timeout=30s', created_at: '2026-10-02T09:00:03+08:00' },
  { id: 5, username: EVIL_DDE, action: 'login_fail', detail: 'ip=1.2.3.4, ua="curl"', created_at: '2026-10-02T09:00:04+08:00' },
]

/** 第二页样本（分页用例用它区分"确实换了页"）。 */
const PAGE2 = [
  { id: 51, username: 'bob', action: 'admin_mfa_login', detail: 'totp', created_at: '2026-10-02T08:00:00+08:00' },
  { id: 52, username: 'carol', action: 'ldap_sync', detail: 'disabled=2', created_at: '2026-10-02T08:00:01+08:00' },
]

let captured = ''
// BOM 必须查**字节**：`Blob.text()` 按规范会吃掉开头的 U+FEFF，用它断言 BOM 永远为假。
let bytes: Uint8Array | null = null
// 每次导出的下载锚点。见 beforeEach：记录点击而不是放 jsdom 去"导航"（jsdom 不实现，且证明不了任何东西）。
let downloadAnchors: { href: string; download: string }[] = []

/**
 * 等到表格出现 rows 行数据（不含表头行）。
 *
 * 空态/加载态各占 1 行（`TableRow` 包 `EmptyState`），所以只用于 rows>=2 的场景。
 */
async function waitForRows(rows: number): Promise<void> {
  await waitFor(
    () => expect(within(screen.getByTestId('system-log-card')).getAllByRole('row')).toHaveLength(rows + 1),
    { timeout: 5000 },
  )
}

/** 默认 mock：/audit 列表按 page 返回。 */
function defaultImpl(path: string): unknown {
  if (String(path).startsWith('/api/server/admin/audit?')) {
    const q = new URLSearchParams(String(path).split('?')[1] ?? '')
    return { logs: q.get('page') === '2' ? PAGE2 : LOGS, total: 120 }
  }
  return {}
}

beforeEach(() => {
  mockRequest.mockReset()
  mockRequest.mockImplementation(async (path: string) => defaultImpl(path))
  captured = ''
  bytes = null
  ;(globalThis.URL as any).createObjectURL = (blob: Blob) => {
    void blob.text().then((t) => { captured = t })
    void blob.arrayBuffer().then((b) => { bytes = new Uint8Array(b) })
    return 'blob:test'
  }
  ;(globalThis.URL as any).revokeObjectURL = () => {}
  downloadAnchors = []
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloadAnchors.push({ href: this.href, download: this.download })
  }
})

describe('系统日志页：列表渲染与筛选', () => {
  it('渲染系统事件行:中文标签/操作者/详情,登记的 action 不回落成裸 id', async () => {
    render(<SystemLogs />)
    await waitForRows(LOGS.length)

    // 系统事件必须显示中文标签（登录/管理员自助/普通管理操作）。
    expect(screen.getByText('登录成功')).toBeInTheDocument()
    expect(screen.getAllByText('登录失败')).toHaveLength(2)
    expect(screen.getByText('修改密码')).toBeInTheDocument()
    expect(screen.getByText('网关配置变更')).toBeInTheDocument()
    // 操作者与详情（详情是截断单元，用 aria-label 承载全文）。
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByLabelText('timeout=30s')).toBeInTheDocument()
    // 已登记的动作不得再出现裸 id。
    for (const raw of ['login_success', 'login_fail', 'password_change', 'gateway_config']) {
      expect(screen.queryByText(raw)).toBeNull()
    }
  })

  it('筛选下拉暴露系统事件动作(后端 ?action= 精确匹配的唯一入口)', async () => {
    render(<SystemLogs />)
    await waitForRows(LOGS.length)
    fireEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByRole('option', { name: '登录失败' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '管理员 MFA 登录' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'LDAP 同步' })).toBeInTheDocument()
  })

  it('按操作筛选:选中后点「筛选」→ 请求带 action 参数,并回到第 1 页', async () => {
    render(<SystemLogs />)
    await waitForRows(LOGS.length)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: '登录失败' }))
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))

    await waitFor(() => {
      const calls = mockRequest.mock.calls.map(([p]) => String(p))
      expect(calls.some((p) => p.startsWith('/api/server/admin/audit?') && p.includes('action=login_fail'))).toBe(true)
    })
    // 应用后出现「清除筛选」。
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument()
  })

  it('按操作者筛选:Enter 触发,请求带 username 参数', async () => {
    render(<SystemLogs />)
    await waitForRows(LOGS.length)

    const input = screen.getByPlaceholderText('操作者')
    fireEvent.change(input, { target: { value: 'mallory' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      const calls = mockRequest.mock.calls.map(([p]) => String(p))
      expect(calls.some((p) => p.includes('username=mallory'))).toBe(true)
    })
  })

  it('加载未完成时不渲染"暂无系统日志"(把"没读到"说成"没有"是倒退)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mockRequest.mockImplementation(async (path: string) => {
      if (String(path).startsWith('/api/server/admin/audit?')) {
        await gate
        return { logs: [], total: 0 }
      }
      return {}
    })
    render(<SystemLogs />)
    // 加载期：说明"在加载"，而不是断言"没有记录"。
    expect(screen.getByText('系统日志加载中…')).toBeInTheDocument()
    expect(screen.queryByText('暂无系统日志')).toBeNull()
    release()
    // 真的读到了、并且确实是空 ⇒ 才允许渲染空态。
    expect(await screen.findByText('暂无系统日志')).toBeInTheDocument()
  })
})

describe('系统日志 CSV 导出(公式注入 + BOM)', () => {
  async function exportCsv(): Promise<string> {
    render(<SystemLogs />)
    // 必须等数据行出现再点导出：导出读组件 state，提前点只会拿到表头。
    await waitForRows(LOGS.length)
    fireEvent.click(screen.getByRole('button', { name: /导出 CSV/ }))
    await waitFor(() => {
      expect(captured).not.toBe('')
      expect(bytes).not.toBeNull()
    })
    return captured
  }

  it("以 = 开头的操作者被加 ' 前缀中和,带 UTF-8 BOM,逗号/引号照旧转义", async () => {
    const csv = await exportCsv()
    // 公式注入：前缀是"中和"不是"删除"，原文完整保留。
    expect(csv).toContain(`'${EVIL_DDE}`)
    expect(csv).not.toContain(`"${EVIL_DDE}"`)
    // BOM：字节级 EF BB BF。
    expect(bytes!.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
    // 表头 + 正文转义（detail 里的逗号与引号）。
    expect(csv.split('\n')[0]).toBe('id,username,action,detail,created_at')
    expect(csv).toContain('"ip=1.2.3.4, ua=""curl"""')
    // 普通值不加前缀。
    expect(csv).toContain('alice')
    expect(csv).not.toContain("'alice")
    // 真的发生了一次下载：文件名 = 系统日志的当日文件名。
    expect(downloadAnchors).toEqual([
      { href: 'blob:test', download: `system-logs-${new Date().toISOString().slice(0, 10)}.csv` },
    ])
  })

  it('未加载完(闸门未开)时导出按钮禁用:不把空表固化成 CSV 留档', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mockRequest.mockImplementation(async (path: string) => {
      if (String(path).startsWith('/api/server/admin/audit?')) {
        await gate
        return { logs: LOGS, total: LOGS.length }
      }
      return {}
    })
    render(<SystemLogs />)
    expect(screen.getByRole('button', { name: /导出 CSV/ })).toBeDisabled()
    release()
    // 数据落地后才可导出。
    await waitFor(() => expect(screen.getByRole('button', { name: /导出 CSV/ })).toBeEnabled())
  })
})

describe('系统日志分页', () => {
  it('显示页码/总数,边界禁用正确,翻页请求带 page 参数', async () => {
    render(<SystemLogs />)
    await waitForRows(LOGS.length)

    // total=120、每页 50 ⇒ 3 页；首屏在第 1 页。
    expect(screen.getByText(/第 1\/3 页/)).toBeInTheDocument()
    expect(screen.getByText(/共 120 条/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(mockRequest.mock.calls.map(([p]) => String(p)).some((p) => p.includes('page=2'))).toBe(true)
    })

    // 第二页数据落地 ⇒ 页码推进、上一页解锁。
    await waitForRows(PAGE2.length)
    expect(screen.getByText(/第 2\/3 页/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
  })

  it('末页的「下一页」禁用(不能越界请求)', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (String(path).startsWith('/api/server/admin/audit?')) return { logs: LOGS, total: LOGS.length }
      return {}
    })
    render(<SystemLogs />)
    await waitForRows(LOGS.length)
    // total=5 < 每页 50 ⇒ 只有 1 页，两端都禁用。
    expect(screen.getByText(/第 1\/1 页/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })
})

// 标签表自证：动作 id 与中文标签一一对应，且全部非空（空标签会在行内显示成空白）。
describe('系统事件动作标签表自证', () => {
  it('每个动作都有非空中文标签', () => {
    const entries = Object.entries(SENSITIVE_ACTION_LABEL)
    expect(entries.length).toBeGreaterThan(10)
    for (const [action, label] of entries) {
      expect(label.trim(), `${action} 的标签不能为空`).not.toBe('')
    }
    // 覆盖需求点名的几类系统事件。
    for (const required of ['login_success', 'login_fail', 'admin_mfa_login', 'password_change', 'gateway_config']) {
      expect(SENSITIVE_ACTION_LABEL[required], `缺少 ${required} 的标签`).toBeTruthy()
    }
  })
})
