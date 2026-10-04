import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { request } from '../../api'
import { setCurrentAdmin } from '../../lib/rbac'
import { rangePreset, monthRange } from '../../lib/format'
import Overview from './Overview'
import Departments from './Departments'
import Members from './Members'
import MemberDetail from './MemberDetail'
import Models from './Models'
import Logs from './Logs'
import Balance from './Balance'
import { ROUTER_FUTURE } from '@/lib/router-future'

// 图表懒加载(VChart)在 jsdom 无 canvas:统一 mock 为占位
vi.mock('../../components/chart-lazy', () => ({
  ChartLazy: () => <div data-testid="chart-mock" />,
}))

const mockRequest = vi.mocked(request)

const USERS = [
  { id: 1, username: 'alice', display_name: '', role: 'user', status: 1, is_admin: false, balance_money: 88.5, balance_activated: true, monthly_usage: 1000, monthly_cost: 12.34, groups: ['研发部'] },
  { id: 2, username: 'bob', display_name: 'Bob', role: 'user', status: 1, is_admin: false, balance_money: 0, balance_activated: false, monthly_usage: 90000, monthly_cost: 3.21, groups: [] },
  { id: 3, username: 'boss', display_name: '', role: 'super_admin', status: 1, is_admin: true, balance_money: 0, balance_activated: false, monthly_usage: 0, monthly_cost: 0, groups: [] },
]

const DEPTS = [
  { id: 1, name: '研发部', parent_id: 2, leader_name: 'alice', member_count: 2 },
  { id: 2, name: '全员', parent_id: 0, leader_name: '', member_count: 3 },
]

const usageRow = (label: string, cost: number, requests = 1, pt = 100, ct = 50) => ({
  label, prompt_tokens: pt, completion_tokens: ct, requests,
  embed_requests: 0, embed_tokens: 0, cache_tokens: 0, cost,
})

beforeEach(() => {
  mockRequest.mockReset()
  mockRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/server/admin/usage/overview')) {
      return {
        range: { cost: 20, tokens: 300, requests: 3 },
        month: { cost: 100, tokens: 1000, requests: 10 },
        today: { cost: 5, tokens: 60, requests: 1 },
        trend: [usageRow('2026-09-01', 12), usageRow('2026-09-02', 8)],
        top_models: [usageRow('deepseek-chat', 18), usageRow('gpt-4o', 2)],
      }
    }
    if (path === '/api/server/admin/providers') return { providers: [{ id: 1, name: 'DeepSeek', base_url: 'https://api.deepseek.com', enabled: true }] }
    if (path === '/api/server/admin/providers/1/balance') {
      return { supported: true, is_available: true, fetched_at: '2026-09-02T10:00:00Z', infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] }
    }
    if (path === '/api/server/admin/departments') return { departments: DEPTS }
    if (path.startsWith('/api/server/admin/usage?group=dept')) return { rows: [usageRow('研发部', 15.55, 5), usageRow('全员', 15.55, 5)] }
    if (path.startsWith('/api/server/admin/usage?group=day')) return { rows: [usageRow('2026-09-01', 1), usageRow('2026-09-02', 2)] }
    if (path.startsWith('/api/server/admin/usage?group=user')) return { rows: [usageRow('alice', 12.34, 5), usageRow('bob', 3.21, 2)] }
    if (path.startsWith('/api/server/admin/usage?group=model')) return { rows: [usageRow('deepseek-chat', 14), usageRow('embed-model', 1, 1, 10, 0)] }
    if (path.startsWith('/api/server/admin/usage?group=provider')) return { rows: [usageRow('DeepSeek', 14), usageRow('(未配置渠道)', 1)] }
    if (path.startsWith('/api/server/admin/usage/requests')) return { rows: [{ id: 9, time: '2026-09-02T10:00:00Z', user_id: 1, username: 'alice', model: 'deepseek-chat', kind: 'chat', prompt_tokens: 100, completion_tokens: 50, cache_tokens: 0, cost: 0.12 }], total: 1, page: 1, size: 20, kind: '' }
    if (path === '/api/server/admin/models') return { models: [{ id: 1, name: 'deepseek-chat', provider_id: 1, display_name: '', default_params: '{}', input_price_per_1m: 2, output_price_per_1m: 8, cache_input_price_per_1m: null, offpeak_discount: null }, { id: 2, name: 'embed-model', provider_id: 1, display_name: '', default_params: '{}', input_price_per_1m: null, output_price_per_1m: null, cache_input_price_per_1m: null, offpeak_discount: null }] }
    if (path === '/api/server/admin/gateway') return { default_model: 'deepseek-chat', rate_limit: '60', peak_windows: '', server_base_url: '' }
    if (path === '/api/server/admin/balance') {
      return {
        settings: { enabled: true, monthly_amount: 100, monthly_mode: 'add' },
        last_grant: { month: '202609', mode: 'add', amount: 100, affected: 2 },
        month_grant: { month: '202609', mode: 'add', amount: 100, affected: 2 },
        status: { month: '202609', eligible: 3, granted: 2, pending: 1, activated: 1 },
        users: 3,
        total_balance: 88.5,
      }
    }
    if (path.includes('/balance/ledger')) return { items: [], total: 0, ledger_sum: 88.5, balance_money: 88.5 }
    if (path.startsWith('/api/server/admin/users')) return { users: USERS, total: 3 }
    return {}
  })
})

function renderAt(path: string, ui: React.ReactNode, routePath?: string) {
  return render(
    <MemoryRouter future={ROUTER_FUTURE} initialEntries={[path]}>
      <Routes>
        <Route path={routePath ?? path} element={ui} />
      </Routes>
    </MemoryRouter>,
  )
}

// 权限快照是 lib/rbac 的模块级状态：本文件里凡显式 setCurrentAdmin 的用例都必须复位，
// 否则会渗到同文件后面的用例（渲染成"另一个角色"的视角）。
afterEach(() => setCurrentAdmin(null))

describe('用量中心 · 总览', () => {
  it('渲染渠道余额卡、KPI 行、趋势与模型 TOP', async () => {
    renderAt('/usage', <Overview />)
    expect(await screen.findByText('上游账户余额')).toBeInTheDocument()
    expect(await screen.findByText('110.00')).toBeInTheDocument() // DeepSeek 余额
    expect(await screen.findByText('赠金 10.00')).toBeInTheDocument()
    expect(screen.getByTestId('overview-kpis')).toBeInTheDocument()
    // KPI 主口径已是 Token（2026-10 内网交付口径：管理端不展示金额/余额）。
    expect(await screen.findByText('本月 Token')).toBeInTheDocument()
    expect(await screen.findByText('今日 Token')).toBeInTheDocument()
    expect(screen.getByText('消耗趋势')).toBeInTheDocument()
    expect(screen.getByText('模型消耗 TOP 10')).toBeInTheDocument()
    expect(screen.getAllByTestId('chart-mock').length).toBeGreaterThanOrEqual(2)
  })

  // 审计 2026-09-12 P1-1(回归):预设按钮曾 `setFrom/setTo` 后同步调
  // **上一次渲染**的 onQuery 闭包 → 请求打到旧区间,而 KPI 标签(`desc={from} ~ {to}`)
  // 用新值渲染。断言「点预设后最新请求的 from == 输入框当前值」。
  it('预设按钮(近7天/近30天/本月)用新区间取数:请求参数 == 输入框值', async () => {
    renderAt('/usage', <Overview />)
    await screen.findByTestId('overview-kpis')

    const overviewCalls = () => mockRequest.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.includes('/usage/overview'))
    // ES2020 目标(tsconfig lib 无 ES2022),不用 Array.prototype.at。
    const latestOverviewCall = () => {
      const calls = overviewCalls()
      return calls[calls.length - 1]
    }
    const inputFrom = () => (screen.getByLabelText('起始日期') as HTMLInputElement).value
    const inputTo = () => (screen.getByLabelText('结束日期') as HTMLInputElement).value

    for (const [label, days] of [['近7天', 7], ['近30天', 30]] as const) {
      const expected = rangePreset(days)
      fireEvent.click(screen.getByRole('button', { name: label }))
      await waitFor(() => {
        // 改前:latest 恒等于点击**之前**的区间(闭包读到旧 state) → 断言红。
        expect(latestOverviewCall()).toContain(`from=${expected.from}&to=${expected.to}`)
      })
      expect(inputFrom()).toBe(expected.from)
      expect(inputTo()).toBe(expected.to)
      expect(latestOverviewCall()).toContain(`from=${inputFrom()}&to=${inputTo()}`)
    }

    const month = monthRange()
    fireEvent.click(screen.getByRole('button', { name: '本月' }))
    await waitFor(() => {
      expect(latestOverviewCall()).toContain(`from=${month.from}&to=${month.to}`)
    })
    expect(inputFrom()).toBe(month.from)
  })

  it('「查询」按钮用输入框当前值取数', async () => {
    renderAt('/usage', <Overview />)
    await screen.findByTestId('overview-kpis')
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-01-05' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-02-06' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    await waitFor(() => {
      const calls = mockRequest.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/usage/overview'))
      expect(calls[calls.length - 1]).toContain('from=2026-01-05&to=2026-02-06')
    })
  })
})

describe('用量中心 · 部门用量', () => {
  it('持有 dept:read 时必须请求组织树并渲染成员列(正向夹具)', async () => {
    // 第三十二轮 FIX-47 子泳道 B：本用例是 auditor-access.test.tsx 那条负例
    //（「不请求需要 dept:read 的组织树」）的**另一半**。
    //
    // 为什么必须有这一半：`hasPermission` 在实参匹配不上任何权限点（例如把
    // `PERM_DEPT_READ` 就地写成行内字面量 `'dept:raed'`）时对**所有角色**恒 false，
    // 而负例在 `canReadDepts === false` 时照样通过 —— "取值在夹具里不存在"与
    // "实现正确"无法区分（第三十一轮 AD2 真跑：变异后 pages/usage 5 files / 28 tests
    // 全绿）。这里**显式授予 dept:read**，断言请求真的发出、且只有组织树才有的
    // 「成员」列真的渲染 —— 实参写错任何一处，本用例当场红。
    setCurrentAdmin({ role: 'super_admin', permissions: ['dept:read', 'usage:read'] })
    renderAt('/usage', <Departments />)
    await screen.findByText('研发部')

    const paths = mockRequest.mock.calls.map(([p]) => String(p))
    expect(paths).toContain('/api/server/admin/departments')
    expect(screen.getAllByRole('columnheader', { name: '成员' }).length).toBeGreaterThan(0)
    // 也不该出现"没有 dept:read"的说明（那是没权限时的文案）。
    expect(screen.queryByText(/没有组织架构读取权限/)).toBeNull()
  })

  it('渲染部门表与部门详情下钻', async () => {
    renderAt('/usage', <Departments />)
    expect(await screen.findByText('研发部')).toBeInTheDocument()
    // 2026-10 内网交付 §6(金额 → Token):「区间费用」列已删,换成「区间总 Token」。
    // 夹具两行部门各 100 输入 + 50 输出 = 150 → fmtTokens(150)='150'。
    expect(screen.getAllByRole('columnheader', { name: '区间总 Token' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('columnheader', { name: /费用|金额/ })).toBeNull()
    expect((await screen.findAllByText('150')).length).toBeGreaterThanOrEqual(1)
    // 回归守卫:旧的钱文案(`¥15.55`)必须彻底消失。
    expect(screen.queryByText(/¥/)).toBeNull()
    // 点击部门行 → 详情(成员排行 + 模型用量)
    fireEvent.click(screen.getByText('研发部'))
    expect(await screen.findByText('成员用量排行')).toBeInTheDocument()
    expect(await screen.findByText('alice')).toBeInTheDocument()
    // 成员行的三列口径 = 输入/输出/总 Token(旧列「花费」已删)。
    for (const col of ['输入 Token', '输出 Token', '总 Token']) {
      expect(screen.getAllByRole('columnheader', { name: col }).length).toBeGreaterThanOrEqual(1)
    }
    expect(screen.queryByText('成员消费排行')).toBeNull() // 旧的金额口径标题
    // 模型用量徽章(旧标题「模型花费」已删):deepseek-chat 100+50=150 Token。
    expect(await screen.findByText('模型用量')).toBeInTheDocument()
    expect(await screen.findByText('deepseek-chat 150 Token')).toBeInTheDocument()
    expect(screen.queryByText('模型花费')).toBeNull()
    expect(screen.getByText('导出 CSV')).toBeInTheDocument()
  })
})

describe('用量中心 · 成员用量', () => {
  it('渲染成员表并链接到个人详情', async () => {
    renderAt('/usage/members', <Members />)
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('研发部')).toBeInTheDocument() // 部门列
    expect(screen.getByText('1K')).toBeInTheDocument() // alice 月度用量 monthly_usage=1000 → fmtTokens='1K'
    expect(screen.getByText('90K')).toBeInTheDocument() // bob monthly_usage=90000 → '90K'
    expect(screen.getByRole('link', { name: /alice/ })).toHaveAttribute('href', '/usage/members/alice')
    // 2026-10 内网交付 §6:旧的「账户余额」列(¥88.50)已删,回归守卫确认没有 ¥ 文案。
    expect(screen.queryByText(/¥/)).toBeNull()
    expect(screen.queryByText('未开通')).toBeNull()
    // P3: 员工数不再假设「仅一名超管」——3 个账号 1 个超管 → 2 名员工
    expect(screen.getByText('共 2 名员工')).toBeInTheDocument()
  })

  it('个人详情:徽章 + 趋势 + 模型构成 + 最近请求', async () => {
    renderAt('/usage/members/alice', <MemberDetail />, '/usage/members/:username')
    expect(await screen.findByText('成员用量 · alice')).toBeInTheDocument()
    // 2026-10 内网交付 §6:徽章收敛成一条「月度用量」(旧「本月消耗 ¥… / 本月 tokens …」已删)。
    expect(await screen.findByText(/月度用量/)).toBeInTheDocument()
    expect(await screen.findByText('模型构成')).toBeInTheDocument()
    expect((await screen.findAllByText('deepseek-chat')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('最近请求')).toBeInTheDocument()
    expect(screen.getByText(/2026-09-02 10:00:00/)).toBeInTheDocument()
    expect(screen.getAllByTestId('chart-mock').length).toBeGreaterThanOrEqual(1)
    // 回归守卫:旧「账户余额 ¥88.50」徽章与「本月消耗」措辞都必须消失。
    expect(screen.queryByText(/账户余额|¥|本月消耗/)).toBeNull()
  })
})

describe('用量中心 · 模型分析', () => {
  it('渲染模型 Token 明细列、渠道消耗与 Token 占比图', async () => {
    renderAt('/usage', <Models />)
    expect(await screen.findByText('模型明细')).toBeInTheDocument()
    expect(await screen.findByText('deepseek-chat')).toBeInTheDocument()
    // 2026-10 内网交付 §6:旧的「单价(¥/1M)」列与「未定价」徽章已删;
    // 表头换成 Token 口径,«单价» 数字 2.00/8.00 不再出现在本页。
    for (const col of ['输入 Token', '输出 Token', '缓存 Token', '总 Token']) {
      expect(screen.getAllByRole('columnheader', { name: col }).length).toBeGreaterThanOrEqual(1)
    }
    expect(screen.queryByRole('columnheader', { name: /单价|费用|金额/ })).toBeNull()
    expect(screen.queryByText('未定价')).toBeNull()
    expect(screen.queryByText(/2\.00 \/ 8\.00/)).toBeNull() // 旧单价文案的回归守卫
    // deepseek-chat:输入 100 + 输出 50 = 150 总 Token(模型明细行与渠道消耗行各一次)。
    expect((await screen.findAllByText('150')).length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('渠道消耗')).toBeInTheDocument()
    expect(screen.getByText('(未配置渠道)')).toBeInTheDocument()
    // 旧「金额占比」卡已被「Token 占比」取代(不是改名后的同一张金额图)。
    expect(screen.getByText('Token 占比')).toBeInTheDocument()
    expect(screen.queryByText('金额占比')).toBeNull()
  })
})

describe('用量中心 · 请求日志', () => {
  it('渲染统计徽标、过滤条件与明细分页', async () => {
    renderAt('/usage', <Logs />)
    expect(await screen.findByText(/区间请求/)).toBeInTheDocument()
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(await screen.findByText('deepseek-chat')).toBeInTheDocument()
    expect(screen.getByText(/共 1 条/)).toBeInTheDocument()
    // 过滤条件存在
    expect(screen.getByText('过滤条件')).toBeInTheDocument()
    expect(screen.getByText('导出 CSV')).toBeInTheDocument()
  })
})

describe('用量中心 · 余额', () => {
  // 2026-10 内网交付 §6:路由 `/usage/balance` 保留,但页面内容从「钱的编辑面」
  // 整体改成「Token 用量视图」—— 发放策略卡、额度输入、保存、立即补发、¥ 快捷金额、
  // 行内「调整」与金额预览对话框**全部删除**。下面三条用例断言这一新读面,
  // 并各自带一条「旧写面已消失」的回归守卫(不再是原来那三条写面用例)。
  it('不再请求发放策略接口:没有任何写控件,读面照常渲染成员 Token 用量', async () => {
    renderAt('/usage', <Balance />)
    // 读面:成员列表(过滤掉 super_admin)与月度 Token 用量都在。
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('1K')).toBeInTheDocument() // alice monthly_usage=1000 → '1K'
    expect(screen.queryByText('boss')).not.toBeInTheDocument() // super_admin 不入表

    // 回归守卫:旧的余额写面一个都不许出现。
    expect(screen.getAllByRole('button', { name: /用量明细/ }).length).toBe(2) // alice / bob
    expect(screen.queryByRole('button', { name: /保存/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /立即补发本月/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整/ })).toBeNull()
    expect(screen.queryByLabelText('每人每月额度(元)')).toBeNull()
    for (const v of ['¥50', '¥100', '¥200', '¥500']) {
      expect(screen.queryByRole('button', { name: v })).toBeNull()
    }
    // 旧口径的金额/余额文案不得回潮。
    expect(screen.queryByText(/¥/)).toBeNull()
    expect(screen.queryByText(/账户余额|发放策略|每人每月额度/)).toBeNull()

    // 前端不再调用余额写/读接口(接口仍在服务端保留,只是本页不碰)。
    const paths = mockRequest.mock.calls.map(([p]) => String(p))
    expect(paths.some((p) => p.startsWith('/api/server/admin/balance'))).toBe(false)
    expect(paths.some((p) => p.includes('/balance/ledger'))).toBe(false)
  })

  it('打开用量明细弹窗:今日/月度用量按 Token 口径,不再有金额预览', async () => {
    renderAt('/usage', <Balance />)
    await screen.findByText('alice')
    fireEvent.click(screen.getAllByRole('button', { name: /用量明细/ })[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('今日用量')).toBeInTheDocument()
    expect(within(dialog).getByText('月度用量')).toBeInTheDocument()
    // 弹窗内三张表统一 Token 口径。
    for (const col of ['输入 Token', '输出 Token', '总 Token']) {
      expect(within(dialog).getAllByRole('columnheader', { name: col }).length).toBeGreaterThanOrEqual(1)
    }
    // 回归守卫:旧的金额调整预览(`¥108.50` 之类)不在弹窗里。
    expect(within(dialog).queryByText('¥108.50')).toBeNull()
    expect(within(dialog).queryByText(/¥/)).toBeNull()
    expect(within(dialog).queryByText(/调整余额|余额预览/)).toBeNull()
  })

  it('?user= 深链自动打开该成员的用量明细(读面深链仍可用)', async () => {
    render(
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={['/usage/balance?user=alice']}>
        <Routes>
          <Route path="/usage/balance" element={<Balance />} />
        </Routes>
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('用量明细 · alice')).toBeInTheDocument()
    // 深链打开的是用量面,不是旧的「调整余额」对话框。
    expect(within(dialog).queryByText(/调整余额/)).toBeNull()
  })
})
