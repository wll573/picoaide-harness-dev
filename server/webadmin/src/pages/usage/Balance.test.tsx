import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { request } from '../../api'
import { setCurrentAdmin, type MeUser } from '../../lib/rbac'
import UsageBalance from './Balance'
import { ROUTER_FUTURE } from '@/lib/router-future'

// ---------------------------------------------------------------------------
// 「金额 → Token」迁移后的成员用量页(`/usage/balance`)。
//
// 2026-10 内网交付需求 §6:管理端不显示金额/余额/充值/付费文案。页面已从
// 「余额编辑面」整体重写成「Token 用量视图」——充值按钮、¥ 快捷金额、
// 「每人每月额度(元)」输入框、行内「调整」、流水、发放方式**全部删除**,
// 数据源从 `/balance*` 换成既有的 `/users` + `/usage` + `/usage/requests`。
//
// 本文件守住三件事:
//   1. 新口径存在:成员列表的「月度用量」是 Token,明细给「今日用量 / 月度用量 /
//      输入 Token / 输出 Token / 总 Token」,空态是「暂无用量」;
//   2. 旧口径确实没了(迁移回归守卫):页面渲染不出任何 `¥` 金额文本,也没有
//      补发/保存/调整/额度/充值/流水控件;更不会去请求任何一个余额接口;
//   3. 权限矩阵按**新**权限点重挂 —— 成员列表要 user:read、用量明细要 usage:read,
//      两套独立判定(审计 R7-RV-2 的只读语义),缺哪项只降级哪一项,绝不把
//      「没有权限」渲染成「没有数据」。
//      super_admin(未下发 permissions)必须照旧拿到完整读面 —— 修 auditor 不误伤别人。
// ---------------------------------------------------------------------------
const mockRequest = vi.mocked(request)

const AUDITOR: MeUser = { role: 'auditor', permissions: ['audit:read', 'usage:read', 'user:read'] }
const ADMIN: MeUser = { role: 'user', permissions: ['user:read', 'user:write'] }
const SUPER: MeUser = { role: 'super_admin', permissions: undefined }
const EMPLOYEE: MeUser = { role: 'user', permissions: [] }
/** 有 user:read + usage:read、没有 user:write 的部分权限集（等价形态：不是"空权限"才算只读）。 */
const READONLY: MeUser = { role: 'user', permissions: ['user:read', 'usage:read'] }

// `monthly_usage` 是 Token 数(不是金额)。12345 → 列表渲染 "12.3K"(悬浮 title 给 "12,345")。
const USERS = [
  { id: 1, username: 'alice', display_name: 'Alice', status: 1, groups: ['研发部'], balance_money: 50, balance_activated: true, monthly_cost: 1.5, monthly_usage: 12345 },
  { id: 2, username: 'bob', display_name: 'Bob', status: 1, groups: [], balance_money: 0, balance_activated: false, monthly_cost: 0, monthly_usage: 0 },
]

// 今日聚合行:输入 2380 + 输出 150 = 总 2530 → "2.4K" / "150" / "2.5K"。
const USAGE_TODAY = [{ label: '2026-10-02', prompt_tokens: 2380, completion_tokens: 150, requests: 5 }]
// 按模型(本月):2600 + 300 = 2900 → "2.6K" / "300" / "2.9K"(与今日行取值错开,便于唯一定位)。
const USAGE_MODEL = [{ label: 'gpt-4o', prompt_tokens: 2600, completion_tokens: 300, requests: 4 }]
// 最近请求:1234 + 56 = 1290 → "1.2K" / "56" / "1.3K"。
const REQUESTS = {
  rows: [{ id: 7, time: '2026-10-02T10:00:00+08:00', user_id: 1, username: 'alice', model: 'gpt-4o', kind: 'chat', prompt_tokens: 1234, completion_tokens: 56, cache_tokens: 0, cost: 0.01 }],
}

beforeEach(() => {
  mockRequest.mockReset()
  mockRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/server/admin/users?')) return { users: USERS, total: USERS.length }
    if (path.includes('/usage/requests')) return REQUESTS
    if (path.includes('group=day')) return { rows: USAGE_TODAY }
    if (path.includes('group=model')) return { rows: USAGE_MODEL }
    return {}
  })
})

afterEach(() => setCurrentAdmin(null))

function renderPage() {
  return render(<MemoryRouter future={ROUTER_FUTURE}><UsageBalance /></MemoryRouter>)
}

const paths = () => mockRequest.mock.calls.map(([p]) => String(p))

describe('成员用量页(金额→Token 迁移后):写面整体消失,读面照常', () => {
  it('auditor 看到 Token 用量列表与明细,页面渲染不出任何金额/写控件,也不请求余额接口', async () => {
    setCurrentAdmin(AUDITOR)
    const { container } = renderPage()

    // 读面(user:read)照常:两个成员都在。
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()

    // 新口径:列表列头是「月度用量」,单元格是 Token(12345 → 12.3K,title 给完整值)。
    expect(screen.getByText('月度用量')).toBeInTheDocument()
    expect(screen.getByTitle('12,345')).toHaveTextContent('12.3K')

    // 旧口径没了 —— 金额列(「本月费用」「账户余额」)整体删除,不是改名。
    expect(screen.queryByText(/本月费用/)).toBeNull()
    expect(screen.queryByText(/账户余额/)).toBeNull()
    // 旧写面控件一个都不渲染:补发/保存/调整/额度输入/流水/¥ 快捷金额。
    expect(screen.queryByRole('button', { name: /立即补发本月/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^保存$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /流水/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /充值/ })).toBeNull()
    expect(screen.queryByLabelText('每人每月额度(元)')).toBeNull()
    for (const v of ['¥50', '¥100', '¥200', '¥500']) {
      expect(screen.queryByRole('button', { name: v })).toBeNull()
    }
    // 整页没有任何 ¥ 金额文本(需求 §6 的硬约束,也是最直接的回归守卫)。
    expect(container.textContent).not.toContain('¥')

    // 前端不请求任何注定 403 的写接口,也不碰余额面(读余额接口也已下掉)。
    expect(paths()).toContain('/api/server/admin/users?size=200')
    expect(paths().some((p) => p.includes('/balance'))).toBe(false)

    // 明细是 usage:read,auditor 有 —— 点「用量明细」应发出两个读接口。
    fireEvent.click(screen.getAllByRole('button', { name: /用量明细/ })[0]!)
    await waitFor(() => {
      expect(paths().some((p) => p.includes('/usage?'))).toBe(true)
      expect(paths().some((p) => p.includes('/usage/requests'))).toBe(true)
    })
    // 整个弹窗也没有金额/充值/调整文案。
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText(/¥/)).toBeNull()
    expect(dialog.queryByText(/余额/)).toBeNull()
    expect(dialog.queryByText(/充值/)).toBeNull()
  })

  it('点击成员不会弹出任何金额调整对话框;明细弹窗是新口径的 Token 面', async () => {
    setCurrentAdmin(AUDITOR)
    renderPage()
    await screen.findByText('Alice')

    // 旧的「调整余额」对话框连名字都不该出现,点行内文本也开不出来。
    expect(screen.queryByText(/调整余额/)).toBeNull()
    fireEvent.click(screen.getByText('Alice'))
    expect(screen.queryByText(/调整余额/)).toBeNull()

    // 唯一能打开的是「用量明细」读面。
    fireEvent.click(screen.getAllByRole('button', { name: /用量明细/ })[0]!)
    const dialog = within(await screen.findByRole('dialog'))

    // 新词汇齐备:今日用量 / 月度用量 / 输入 Token / 输出 Token / 总 Token。
    expect(dialog.getByText('今日用量')).toBeInTheDocument()
    expect(dialog.getByText('月度用量')).toBeInTheDocument()
    expect(dialog.getAllByText('输入 Token').length).toBeGreaterThan(0)
    expect(dialog.getAllByText('输出 Token').length).toBeGreaterThan(0)
    expect(dialog.getAllByText('总 Token').length).toBeGreaterThan(0)

    // 数字按 Token 口径渲染:月度 12345 → 12.3K;今日合计 2530 → 卡片与拆分各一处;
    // 今日输入/输出、按模型、最近请求三张表各自的取值都对得上。
    expect(dialog.getByText('12.3K')).toBeInTheDocument()      // 月度用量(alice.monthly_usage)
    expect(dialog.getAllByText('2.5K').length).toBe(2)         // 今日用量卡片 + 今日拆分「总 Token」
    expect(dialog.getByText('2.4K')).toBeInTheDocument()       // 今日输入 2380
    expect(dialog.getByText('150')).toBeInTheDocument()        // 今日输出
    expect(dialog.getByText('2.6K')).toBeInTheDocument()       // 按模型输入 2600
    expect(dialog.getByText('300')).toBeInTheDocument()        // 按模型输出
    expect(dialog.getByText('2.9K')).toBeInTheDocument()       // 按模型总 Token 2900
    expect(dialog.getByText('1.2K')).toBeInTheDocument()       // 最近请求输入 1234
    expect(dialog.getByText('56')).toBeInTheDocument()         // 最近请求输出
    expect(dialog.getByText('1.3K')).toBeInTheDocument()       // 最近请求总 Token 1290

    // 弹窗里没有任何金额/余额/充值/调整文案。
    expect(dialog.queryByText(/¥/)).toBeNull()
    expect(dialog.queryByText(/余额/)).toBeNull()
    expect(dialog.queryByText(/充值/)).toBeNull()
    expect(dialog.queryByText(/调整/)).toBeNull()
  })

  it('auditor 用 ?user= 深链进来,自动打开的是「用量明细」而不是任何编辑面', async () => {
    setCurrentAdmin(AUDITOR)
    render(<MemoryRouter future={ROUTER_FUTURE} initialEntries={['/usage/balance?user=alice']}><UsageBalance /></MemoryRouter>)
    await screen.findByText('Alice')

    // 深链确实开了弹窗 —— 但开的是只读的用量明细(有 usage:read 才开)。
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/用量明细/)).toBeInTheDocument()
    expect(dialog.queryByText(/调整余额/)).toBeNull()
    expect(dialog.queryByText(/¥/)).toBeNull()
    expect(paths().some((p) => p.includes('/balance'))).toBe(false)
  })
})

describe('非 auditor 角色不受影响(角色矩阵)', () => {
  it('user:write(admin)仍能看到成员列表,但本页已无写控件,明细按 usage:read 降级', async () => {
    setCurrentAdmin(ADMIN)
    renderPage()
    await screen.findByText('Alice')

    // 读面(user:read)照常:成员与 Token 用量列都在。
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByTitle('12,345')).toHaveTextContent('12.3K')

    // 需求 §6 后本页是纯读面:即便有 user:write,也没有补发/调整/额度控件。
    expect(screen.queryByRole('button', { name: /立即补发本月/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^保存$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整/ })).toBeNull()
    expect(screen.queryByLabelText('每人每月额度(元)')).toBeNull()

    // 缺 usage:read ⇒ 明细入口降级成一句说明,而不是渲染成"没有数据"。
    expect(screen.queryByRole('button', { name: /用量明细/ })).toBeNull()
    expect(screen.getAllByText('需要 usage:read').length).toBe(2)
  })

  it('super_admin(未下发 permissions 的白名单分支)拿到完整读面', async () => {
    setCurrentAdmin(SUPER)
    renderPage()
    await screen.findByText('Alice')
    // 两个成员的明细入口都在(白名单分支不该被收权)。
    expect(screen.getAllByRole('button', { name: /用量明细/ }).length).toBe(2)
    expect(screen.queryByText('需要 usage:read')).toBeNull()
  })

  it('普通员工(无任何管理权限):不请求列表,并说明缺的是 user:read', async () => {
    setCurrentAdmin(EMPLOYEE)
    renderPage()
    // 没有 user:read ⇒ 不发注定 403 的请求,只给权限说明。
    expect(await screen.findByText(/没有员工读取权限/)).toBeInTheDocument()
    expect(mockRequest).not.toHaveBeenCalled()
    // 不编造成员行(没有把"没权限"画成一份空的成员表数据)。
    expect(screen.queryByText('Alice')).toBeNull()
    expect(screen.queryByText('Bob')).toBeNull()
  })

  it('只有 user:read + usage:read 的部分权限集同样是完整读面(等价形态)', async () => {
    setCurrentAdmin(READONLY)
    renderPage()
    await screen.findByText('Alice')
    // 与 auditor 同形:有明细入口,没有任何写控件。
    expect(screen.getAllByRole('button', { name: /用量明细/ }).length).toBe(2)
    expect(screen.queryByRole('button', { name: /立即补发本月/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^保存$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整/ })).toBeNull()
    expect(screen.queryByText(/余额/)).toBeNull()
  })
})
