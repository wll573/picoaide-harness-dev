import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { request, ADMIN_API } from '../../api'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { Input } from '../../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { PageHeader } from '../../components/page-header'
import { employeeCountText, fetchUsageList, type UsageRow, type UsageRequestRow, type UserInfo } from './common'
import { fmtTokens, fmtFull } from '../../lib/format'
import { PERM_USAGE_READ, PERM_USER_READ, hasPermission } from '../../lib/rbac'
import { Activity, CalendarDays, Cpu, ScrollText } from 'lucide-react'

// ---------------------------------------------------------------------------
// 成员 Token 用量(2026-10 内网交付需求 §6:管理端不显示金额/余额/充值/付费文案)
//
// 路由 `/usage/balance` 保留 —— 老书签与用量中心子导航不会 404。页面内容从
// 「余额面」整体改成「Token 用量面」:充值按钮、¥ 快捷金额、金额输入框、
// 调整后余额预览、余额闸门开关**全部删除**。
//
// **接口与数据一个都没删**:`GET/PUT /api/server/admin/balance`、
// `POST /api/server/admin/balance/grant`、`POST /users/:id/balance`、
// `GET /users/:id/balance/ledger` 与 `users.balance_money` 全部保留在原处
// (既有部署的历史账本与对账路径不受影响),只是本页不再调用其中任何一个。
// 交付需求 §6 原文即「后端保留兼容字段,避免已有数据和接口失效」。
//
// 本页使用的三个接口**都是既有的**,不新造:
//   · GET /api/server/admin/users                        (user:read)
//   · GET /api/server/admin/usage?group=model&username=… (usage:read)
//   · GET /api/server/admin/usage/requests?username=…    (usage:read)
// 两套权限分别判定(见下),任一缺失只降级它自己那部分,不等于"没有数据"。
// ---------------------------------------------------------------------------

// 逐行 Token 合计:输入 + 输出。
// `UsageRow` / `UsageRequestRow` 都**没有** `tokens` 字段(它们给的是
// prompt_tokens / completion_tokens),所以在这里自己加,别去读不存在的 `r.tokens`。
const rowTokens = (r: { prompt_tokens: number; completion_tokens: number }): number =>
  (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)

// 计数是否可用。字段缺失时报 false(空态文案),**不**用 0 冒充"用了 0 个 token"。
const hasCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// 北京日期值 YYYY-MM-DD。与 serverstore.BeijingDay 同口径:
// 北京日 = 该瞬间 UTC+8 的日历日,与进程 TZ / PG 会话时区无关。
// 本地实现而**不**引入服务端语义(前端只有浏览器时区),所以显式按 UTC+8 归日。
function beijingToday(now: Date = new Date()): Date {
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()))
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 今日用量窗口:北京日的 [今天, 今天](两端都是北京日期值)。 */
function todayWindow(): { from: string; to: string } {
  const d = ymd(beijingToday())
  return { from: d, to: d }
}

/** 月度用量窗口:北京月的 [1 日, 今天]。与 `/users` 的 `monthly_usage`
 *  (UserMonthlyUsage 的北京月界)是同一口径 —— 同一个数字,不是两套算法。 */
function monthWindow(): { from: string; to: string } {
  const d = beijingToday()
  return { from: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`, to: ymd(d) }
}

function fmtTime(s: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface DetailState {
  today: { input: number; output: number; total: number; requests: number } | null
  models: UsageRow[]
  requests: UsageRequestRow[]
}

export default function UsageBalance() {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [rawCount, setRawCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')

  // 详情弹窗
  const [target, setTarget] = useState<UserInfo | null>(null)
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState('')

  const loadSeq = useRef(0)
  const detailSeq = useRef(0)

  const [searchParams] = useSearchParams()
  const presetUser = searchParams.get('user') ?? ''

  // 体验层能力判定(护栏在服务端 RequirePermission):
  //   · 成员列表 —— GET /users 要 user:read;
  //   · 用量明细 —— GET /usage 与 GET /usage/requests 要 usage:read。
  // 两者是**独立**权限点(auditor 两个都有;user:read-only 的角色只有前者)。
  // 缺哪一项就只说明那一项,不把"没有权限"渲染成"没有数据"。
  const canReadUsers = hasPermission(PERM_USER_READ)
  const canReadUsage = hasPermission(PERM_USAGE_READ)

  const load = useCallback(async (query: string) => {
    const current = ++loadSeq.current
    setLoading(true)
    setListError('')
    if (!canReadUsers) {
      // 不请求注定 403 的接口(服务端 RequirePermission 仍是唯一护栏)。
      setUsers([])
      setRawCount(0)
      setTotal(0)
      setLoading(false)
      return
    }
    try {
      const ul = await request<{ users: UserInfo[]; total: number }>(
        `${ADMIN_API}/users?size=200${query ? `&q=${encodeURIComponent(query)}` : ''}`)
      if (current !== loadSeq.current) return
      const all = ul.users ?? []
      setUsers(all.filter((u) => u.role !== 'super_admin'))
      setRawCount(all.length)
      setTotal(ul.total ?? 0)
    } catch (e: any) {
      if (current === loadSeq.current) {
        // P3(与 R15C-W-07 同族):失败清空列表 —— 旧行不能继续冒充本次查询结果。
        setUsers([])
        setRawCount(0)
        setTotal(0)
        setListError(e?.message || '查询失败')
      }
    } finally {
      if (current === loadSeq.current) setLoading(false)
    }
  }, [canReadUsers])

  useEffect(() => {
    if (presetUser) {
      setQ(presetUser)
      void load(presetUser)
    } else {
      void load('')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // `?user=` 深链(老书签/外部跳转)自动打开该成员的用量明细。
  // 没有 usage:read 时**不打开**:那个弹窗整体是用量读入口,打开只会是空的。
  useEffect(() => {
    if (!canReadUsage || !presetUser || target || users.length === 0) return
    const hit = users.find((u) => u.username.toLowerCase() === presetUser.toLowerCase())
    if (hit) void openDetail(hit)
  }, [users]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(u: UserInfo) {
    setTarget(u)
    setDetail(null)
    setDetailError('')
    setDetailBusy(true)
    const current = ++detailSeq.current
    try {
      const tw = todayWindow()
      const mw = monthWindow()
      const [todayRows, modelRows, rq] = await Promise.all([
        // 「今日用量」= 一个北京日窗口的聚合。逐成员的历史总量**没有**管理端接口
        // (`total_usage/input_tokens/output_tokens` 只在员工侧 /api/client/v2/auth/usage),
        // 所以这里不渲染「总 Token」的这一档 —— 宁缺勿造,不拿区间合计冒充历史总量。
        fetchUsageList({ group: 'day', username: u.username, from: tw.from, to: tw.to }),
        fetchUsageList({ group: 'model', username: u.username, from: mw.from, to: mw.to }),
        request<{ rows: UsageRequestRow[] }>(
          `${ADMIN_API}/usage/requests?username=${encodeURIComponent(u.username)}&size=5`),
      ])
      if (current !== detailSeq.current) return // 过期响应丢弃(切换成员时)
      setDetail({
        today: sumWindow(todayRows),
        models: modelRows,
        requests: rq.rows ?? [],
      })
    } catch (e: any) {
      if (current !== detailSeq.current) return
      // 失败 ≠ 空态:清空并显示原因,不渲染「暂无用量」。
      setDetail(null)
      setDetailError(e?.message || '用量加载失败')
    } finally {
      if (current === detailSeq.current) setDetailBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="成员用量" desc="按成员查看 Token 用量:今日与月度用量、按模型明细、最近请求" />

      {!canReadUsers && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          当前账号没有员工读取权限(user:read):成员列表不可见。用量明细需要 usage:read,与列表是两套独立权限点。
        </div>
      )}

      {/* 成员列表:本月 Token 用量(自然月口径)。金额/余额列已整体删除。 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">成员列表</CardTitle>
            <CardDescription>
              月度用量为本自然月口径;点击成员查看其今日用量与按模型明细
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="搜索用户名" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load(q) }} className="h-8 w-48" aria-label="搜索员工" />
            <Button size="sm" variant="outline" onClick={() => void load(q)}>查询</Button>
          </div>
        </CardHeader>
        <CardContent>
          {listError && <div className="mb-2 text-sm text-destructive">{listError}</div>}
          {loading ? <Skeleton className="h-72 w-full" /> : (
            <>
              <div className="mb-2 text-xs text-muted-foreground">{employeeCountText(users, rawCount, total)}</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>成员</TableHead>
                    <TableHead>部门</TableHead>
                    <TableHead className="text-right">月度用量</TableHead>
                    <TableHead className="w-40">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.display_name || u.username}
                        {u.status !== 1 && <Badge variant="destructive" className="ml-2">停用</Badge>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(u.groups ?? []).filter((g) => g !== '全员').join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hasCount(u.monthly_usage)
                          ? <span title={fmtFull(u.monthly_usage)}>{fmtTokens(u.monthly_usage)}</span>
                          : <span className="text-muted-foreground">暂无用量</span>}
                      </TableCell>
                      <TableCell>
                        {canReadUsage
                          ? (
                            <Button size="sm" variant="outline" onClick={() => void openDetail(u)}>
                              <ScrollText className="mr-1 h-3.5 w-3.5" />用量明细
                            </Button>
                          )
                          : <span className="text-xs text-muted-foreground">需要 usage:read</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && !listError && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">暂无用量</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* 成员用量明细:今日用量 / 月度用量 / 输入+输出 / 按模型 / 最近请求 */}
      <Dialog open={canReadUsage && !!target} onOpenChange={(o) => { if (!o) setTarget(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>用量明细 · {target?.username}</DialogTitle>
            <DialogDescription>
              今日用量与月度用量均为 Token 口径;模型明细与最近请求取自请求级计量记录(不含对话内容)。
            </DialogDescription>
          </DialogHeader>

          {detailBusy ? <Skeleton className="h-64 w-full" /> : detailError ? (
            // 失败 ≠ 空态:明说没读到 + 就地重试(修前这里会渲染成「暂无用量」)。
            <div className="space-y-3">
              <div className="text-sm text-destructive">用量读取失败:{detailError}</div>
              <Button size="sm" variant="outline" onClick={() => { if (target) void openDetail(target) }}>重试</Button>
            </div>
          ) : !detail ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无用量</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Activity className="h-3.5 w-3.5" />今日用量
                  </div>
                  <div className="mt-1 font-mono text-lg font-medium tabular-nums">
                    {detail.today ? fmtTokens(detail.today.total) : <span className="text-sm text-muted-foreground">暂无用量</span>}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />月度用量
                  </div>
                  <div className="mt-1 font-mono text-lg font-medium tabular-nums">
                    {hasCount(target?.monthly_usage) ? fmtTokens(target!.monthly_usage) : <span className="text-sm text-muted-foreground">暂无用量</span>}
                  </div>
                </div>
              </div>

              {/* 今日按方向拆分:输入 + 输出 = 总 Token(同一份日聚合行)。 */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>今日用量拆分</TableHead>
                    <TableHead className="text-right">输入 Token</TableHead>
                    <TableHead className="text-right">输出 Token</TableHead>
                    <TableHead className="text-right">总 Token</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.today ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">今日({todayWindow().from})</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(detail.today.input)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(detail.today.output)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(detail.today.total)}</TableCell>
                    </TableRow>
                  ) : (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">暂无用量</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>

              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Cpu className="h-3.5 w-3.5" />按模型用量(本月)
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模型</TableHead>
                      <TableHead className="text-right">请求数</TableHead>
                      <TableHead className="text-right">输入 Token</TableHead>
                      <TableHead className="text-right">输出 Token</TableHead>
                      <TableHead className="text-right">总 Token</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.models.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTokens(r.prompt_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTokens(r.completion_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTokens(rowTokens(r))}</TableCell>
                      </TableRow>
                    ))}
                    {detail.models.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">暂无用量</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">最近请求</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead className="text-right">输入 Token</TableHead>
                      <TableHead className="text-right">输出 Token</TableHead>
                      <TableHead className="text-right">总 Token</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTime(r.time)}</TableCell>
                        <TableCell>{r.model}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTokens(r.prompt_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTokens(r.completion_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTokens(rowTokens(r))}</TableCell>
                      </TableRow>
                    ))}
                    {detail.requests.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">暂无用量</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

            {/* 需求 §6:没有数据时显示「暂无用量」,不编造数字、不折算。 */}
            {!detail.today && detail.models.length === 0 && detail.requests.length === 0 && (
              <div className="text-xs text-muted-foreground">
                该成员在当前窗口内没有用量记录:显示「暂无用量」,不估算、不填 0。
              </div>
            )}

              {/* 本页只展示 Token 用量:整个页面没有任何写入路径。 */}
              <div className="text-[11px] text-muted-foreground">
                本页只展示 Token 用量与请求计量,数据源为用量接口;服务端保留的兼容字段不在此页展示。
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setTarget(null)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 把 `GET /usage?group=day` 的行合成本窗口的输入/输出合计。
 *
 *  `sumRows` 的 `tokens` 是 chat 口径(扣掉 embedding),这里要的是
 *  「总 Token = 输入 + 输出」的直白口径 —— 与按钮上那三个词逐一对应,
 *  所以自己按 prompt + completion 求和,不用 chatTokens。 */
function sumWindow(rows: UsageRow[]): DetailState['today'] {
  if (rows.length === 0) return null
  let input = 0, output = 0, requests = 0
  for (const r of rows) {
    input += r.prompt_tokens ?? 0
    output += r.completion_tokens ?? 0
    requests += r.requests ?? 0
  }
  return { input, output, total: input + output, requests }
}
