import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { ISpec } from '@visactor/vchart'
import { ChartLazy } from '../../components/chart-lazy'
import { request, ADMIN_API } from '../../api'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { PageHeader } from '../../components/page-header'
import { ArrowLeft } from 'lucide-react'
// 2026-10 内网交付口径(§6):本页不再展示金额/余额/充值,因此不再导入
// `fmtY` 与 `fmtMoney`。`common.tsx` 的 `fmtY` 是共享工具(其余模块可能仍在用),
// 只删本页的**导入**,不删那个函数。
import { RangeFilter, defaultRange, fetchUsageList, sumRows, downloadCsv, type UsageRow, type UsageRequestRow, type UserInfo } from './common'
import { fmtTokens, fmtFull } from '../../lib/format'

// 逐行 Token 合计:输入 + 输出。
// `UsageRow` / `UsageRequestRow` 都**没有** `tokens` 字段(它们给的是
// prompt_tokens / completion_tokens),所以在这里自己加,别去读不存在的 `r.tokens`。
const rowTokens = (r: { prompt_tokens: number; completion_tokens: number }): number =>
  (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)

// 成员详情(独立二级页):该成员近30天趋势 + 模型构成 + 最近请求 + 导出
export default function UsageMemberDetail() {
  const { username = '' } = useParams()
  const init = defaultRange()
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [trend, setTrend] = useState<UsageRow[]>([])
  const [models, setModels] = useState<UsageRow[]>([])
  const [requests, setRequests] = useState<UsageRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // P2-46: 请求序号防乱序——快速切换区间/连续查询时只有最新请求的响应能写 state。
  const loadSeq = useRef(0)

  const load = useCallback(async (f: string, t: string) => {
    const current = ++loadSeq.current
    setLoading(true)
    setError('')
    try {
      const [ul, tr, mo, rq] = await Promise.all([
        request<{ users: UserInfo[] }>(`${ADMIN_API}/users?size=50&q=${encodeURIComponent(username)}`),
        fetchUsageList({ group: 'day', username, from: f, to: t }),
        fetchUsageList({ group: 'model', username, from: f, to: t }),
        request<{ rows: UsageRequestRow[] }>(`${ADMIN_API}/usage/requests?username=${encodeURIComponent(username)}&from=${f}&to=${t}&size=5`),
      ])
      if (current !== loadSeq.current) return // P2-46: 过期响应丢弃
      setUser((ul.users ?? []).find((u) => u.username === username) ?? null)
      setTrend(tr)
      setModels(mo)
      setRequests(rq.rows ?? [])
    } catch (e: any) {
      if (current !== loadSeq.current) return // P2-46: 过期响应不写错误
      setError(e.message || '查询失败')
    } finally {
      if (current === loadSeq.current) setLoading(false)
    }
  }, [username])

  useEffect(() => { void load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 趋势以 **Token** 为度量(2026-10 内网交付口径):同一条日聚合响应里 tokens 与
  // cost 都在,换度量只是换取值,不涉及接口改动。
  const trendSpec: ISpec | null = trend.length > 0 ? {
    type: 'line',
    data: { values: trend.map((r) => ({ label: r.label.slice(5), tokens: rowTokens(r) })) },
    xField: 'label',
    yField: 'tokens',
    point: { visible: true },
    axes: [
      { orient: 'left', title: { visible: true, text: '总 Token' }, label: { visible: true, style: { fontSize: 11 } } },
      { orient: 'bottom', label: { visible: true, style: { fontSize: 10 } } },
    ],
    tooltip: { visible: true },
  } : null

  const s = sumRows(trend)
  // 区间总 Token 取 s.prompt + s.completion(与图表逐日取值同一个口径:输入+输出)。
  // **不能**用 s.tokens —— 那是 chat 口径(扣掉了 embedding),和图上画的对不上。
  const rangeTokens = s.prompt + s.completion

  const exportCsv = () => {
    downloadCsv(`member_${username}_${from}_${to}.csv`,
      ['维度', '请求数', '输入 Token', '输出 Token', '总 Token'],
      models.map((r) => [r.label, r.requests, r.prompt_tokens, r.completion_tokens, rowTokens(r)]))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`成员用量 · ${username}`}
        desc="单人的消耗画像:近 30 天按天 Token、模型构成、最近请求(不含对话内容)"
        actions={<Link to="/usage/members"><Button size="sm" variant="outline"><ArrowLeft className="h-3.5 w-3.5" /> 返回成员列表</Button></Link>}
      />
      <RangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} onQuery={(f, t) => void load(f, t)} />
      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {user ? (
          <>
            <Badge variant="outline">部门: {(user.groups ?? []).filter((g) => g !== '全员').join(', ') || '未分配'}</Badge>
            {/* 2026-10 内网交付口径:徽章只讲 Token。原先的「本月消耗 ¥…」与
                「本月 tokens …」是同一份数据的两种口径,收敛成一条「月度用量」;
                「账户余额 ¥…」无 Token 对应物,整条删掉(余额接口与数据一个没动)。
                「总用量」徽章**不渲染**:`/users` 只下发 `monthly_usage`(自然月),
                没有历史总量字段(总 Tokens 只在员工侧的 `/auth/usage` 里)。按约束
                宁缺勿造 —— 不填 0、不拿 cost 反推、也不拿近 30 天区间合计冒充总量。 */}
            <Badge variant="secondary" title={fmtFull(user.monthly_usage)}>月度用量 {fmtTokens(user.monthly_usage)}</Badge>
          </>
        ) : loading ? <Skeleton className="h-6 w-48" /> : null}
      </div>

      {loading ? <Skeleton className="h-80 w-full" /> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">消耗趋势</CardTitle>
                <CardDescription>按天总 Token · {from} ~ {to} · 合计 {fmtFull(rangeTokens)}</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={exportCsv}>导出 CSV</Button>
            </CardHeader>
            <CardContent>
              {trendSpec ? <div className="h-72"><ChartLazy spec={trendSpec} /></div> : <div className="flex h-72 items-center justify-center text-muted-foreground">暂无用量</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">模型构成</CardTitle>
              <CardDescription>按模型 Token</CardDescription>
            </CardHeader>
            <CardContent>
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
                  {models.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell>{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(r.prompt_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(r.completion_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(rowTokens(r))}</TableCell>
                    </TableRow>
                  ))}
                  {models.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">暂无用量</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近请求</CardTitle>
          <CardDescription>最新 5 条调用记录(点开「请求日志」查看全部)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="text-right">输入 Token</TableHead>
                <TableHead className="text-right">输出 Token</TableHead>
                <TableHead className="text-right">总 Token</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.time.replace('T', ' ').slice(0, 19)}</TableCell>
                  <TableCell>{r.model}</TableCell>
                  <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTokens(r.prompt_tokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTokens(r.completion_tokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTokens(rowTokens(r))}</TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">暂无用量</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
