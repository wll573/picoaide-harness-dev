import { useCallback, useEffect, useRef, useState } from 'react'
import type { ISpec } from '@visactor/vchart'
import { ChartLazy } from '../../components/chart-lazy'
import { request, ADMIN_API } from '../../api'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { PageHeader } from '../../components/page-header'
import { CircleDollarSign, Activity, Coins, RefreshCw, Landmark } from 'lucide-react'
import { RangeFilter, defaultRange, sumRows, type OverviewData, type ProviderInfo, type ProviderBalance } from './common'
import { fmtTokens, fmtFull } from '../../lib/format'
import { PERM_GATEWAY_READ, hasPermission } from '../../lib/rbac'

// 总览(主页面):企业整体消耗——上游账户余额 + KPI + 近30天消耗趋势 + 模型 TOP10
export default function UsageOverview() {
  const init = defaultRange()
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [data, setData] = useState<OverviewData | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [balances, setBalances] = useState<Record<number, ProviderBalance | 'loading' | 'error'>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // P2-46: 请求序号防乱序——快速切换区间时只有最新请求的响应能写 state。
  const loadSeq = useRef(0)
  // 上游渠道(及其账户余额)是网关配置面:GET /providers 要 gateway:read。
  // 审计 R7 残余(R7-RV-1):原来这个 403 被 `catch {}` 静默吞掉 —— 区块永远
  // 显示"未配置上游渠道",把"没有权限"说成了"没有配置"(运维据此白排查)。
  const canReadGateway = hasPermission(PERM_GATEWAY_READ)

  const loadBalance = useCallback(async (id: number) => {
    setBalances((prev) => ({ ...prev, [id]: 'loading' }))
    try {
      const b = await request<ProviderBalance>(`${ADMIN_API}/providers/${id}/balance`)
      setBalances((prev) => ({ ...prev, [id]: b }))
    } catch {
      setBalances((prev) => ({ ...prev, [id]: 'error' }))
    }
  }, [])

  const load = useCallback(async (f: string, t: string) => {
    const current = ++loadSeq.current
    setLoading(true)
    setError('')
    try {
      const d = await request<OverviewData>(`${ADMIN_API}/usage/overview?from=${f}&to=${t}`)
      if (current !== loadSeq.current) return // P2-46: 过期响应丢弃
      setData(d)
    } catch (e: any) {
      if (current !== loadSeq.current) return // P2-46: 过期响应不写错误
      setError(e.message || '查询失败')
    } finally {
      if (current === loadSeq.current) setLoading(false)
    }
    if (!canReadGateway) return
    try {
      const pl = await request<{ providers: ProviderInfo[] }>(`${ADMIN_API}/providers`)
      if (current !== loadSeq.current) return
      const list = (pl.providers ?? []) as ProviderInfo[]
      setProviders(list)
      setBalances({})
      list.forEach((p) => void loadBalance(p.id))
    } catch { /* 上游账户余额失败不阻塞总览 */ }
  }, [loadBalance, canReadGateway])

  useEffect(() => { void load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rangeSum = data ? sumRows(data.trend) : null
  const topSum = data ? sumRows(data.top_models) : null

  // KPI 主口径 = **Token**（2026-10 内网交付口径：界面不再展示金额/余额/付费文案）。
  // 金额字段（`cost`）仍在 OverviewData 与接口里原样保留 —— 既有部署的对账路径
  // 不受影响，这里只是不再把它作为首屏主视觉。
  const kpis = data ? [
    { title: '本月 Token', value: fmtTokens(data.month.tokens), desc: `本月请求 ${data.month.requests.toLocaleString()}`, icon: Landmark },
    { title: '今日 Token', value: fmtTokens(data.today.tokens), desc: `今日请求 ${data.today.requests.toLocaleString()}`, icon: Activity },
    { title: '区间 Token', value: fmtTokens(rangeSum!.tokens), desc: `chat 输入+输出，不含 embedding`, icon: Coins },
    { title: '区间请求', value: rangeSum!.requests.toLocaleString(), desc: `${from} ~ ${to}`, icon: CircleDollarSign },
  ] : []

  // 趋势与排行都以 **Token** 为度量（2026-10 内网交付口径）。此前画的是费用，
  // 服务端两种度量都在同一个响应里下发（`UsageRow` 同时带 tokens 与 cost），
  // 所以换度量只是换取值，不涉及接口改动。
  //
  // 注意 `UsageRow` **没有** `tokens` 字段（它给的是 prompt_tokens / completion_tokens
  // / requests / cost）—— 区间聚合的 `range.tokens` 才是已经加总好的那个值。
  // 逐行取 token 时在这里自己加，别去读不存在的 `r.tokens`（那会让 tsc 直接报 TS2339）。
  const rowTokens = (r: { prompt_tokens: number; completion_tokens: number }): number =>
    (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)

  const trendSpec: ISpec | null = data && data.trend.length > 0 ? {
    type: 'bar',
    data: { values: data.trend.map((r) => ({ label: r.label.slice(5), tokens: rowTokens(r) })) },
    xField: 'label',
    yField: 'tokens',
    axes: [
      { orient: 'left', label: { visible: true, style: { fontSize: 11 } } },
      { orient: 'bottom', label: { visible: true, style: { fontSize: 10 } }, title: { visible: true, text: '日期' } },
    ],
    tooltip: { visible: true },
  } : null

  const topSpec: ISpec | null = data && data.top_models.length > 0 ? {
    type: 'bar',
    data: { values: data.top_models.map((r) => ({ label: r.label, tokens: rowTokens(r) })) },
    xField: 'label',
    yField: 'tokens',
    axes: [
      { orient: 'left', label: { visible: true, style: { fontSize: 11 } } },
      { orient: 'bottom', title: { visible: true, text: 'Token' }, label: { formatMethod: (v: unknown) => fmtTokens(Number(v)) } },
    ],
    tooltip: { visible: true },
  } : null

  return (
    <div className="space-y-6">
      <PageHeader title="用量总览" desc="企业整体 Token 用量：本月、今日、区间用量 / 消耗趋势 / 模型排行" />

      <RangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} onQuery={(f, t) => void load(f, t)} />

      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* 上游账户余额卡:账户级信息(DeepSeek 原生 /user/balance;其余渠道置灰说明) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">上游账户余额</CardTitle>
          <Button size="sm" variant="outline" onClick={() => providers.forEach((p) => void loadBalance(p.id))}>
            <RefreshCw className="h-3.5 w-3.5" /> 刷新
          </Button>
        </CardHeader>
        <CardContent>
          {!canReadGateway ? (
            // 没有 gateway:read 时不请求、也不把"没有权限"说成"没有配置"。
            <div className="text-sm text-muted-foreground">
              上游账户余额需要网关配置读取权限(gateway:read):当前账号不可见。其余用量数据不受影响。
            </div>
          ) : providers.length === 0 ? (
            <div className="text-sm text-muted-foreground">未配置上游渠道</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {providers.map((p) => {
                const b = balances[p.id]
                const balance = b && b !== 'loading' && b !== 'error' ? b : null
                const info = balance?.infos?.[0]
                return (
                  <div key={p.id} className="space-y-1.5 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{p.name}</span>
                      <Badge variant="outline">{p.enabled ? '启用' : '禁用'}</Badge>
                    </div>
                    {b === 'loading' ? (
                      <Skeleton className="h-7 w-36" />
                    ) : balance?.supported === false ? (
                      <div className="text-xs text-muted-foreground">该服务商不开放余额查询</div>
                    ) : balance?.error ? (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-destructive">{balance.error}</span>
                        <Button size="sm" variant="outline" onClick={() => void loadBalance(p.id)}>重试</Button>
                      </div>
                    ) : info ? (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xl font-bold tabular-nums">{info.total_balance}</span>
                          <span className="text-xs text-muted-foreground">{info.currency}</span>
                          <Badge variant={balance?.is_available ? 'secondary' : 'destructive'}>
                            {balance?.is_available ? '可调用' : '余额不足'}
                          </Badge>
                        </div>
                        <div className="flex gap-3 text-[11px] text-muted-foreground">
                          <span>赠金 {info.granted_balance}</span>
                          <span>充值 {info.topped_up_balance}</span>
                          <span>{balance?.fetched_at?.slice(11, 16)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">余额查询失败</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI 行:Token 为第一指标 */}
      <div data-testid="overview-kpis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((c) => (
          <Card key={c.title}>
            <CardContent className="flex h-full flex-col pt-5">
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1E40AF]/10 text-[#1E40AF]">
                  <c.icon className="h-3.5 w-3.5" />
                </div>
                <span className="whitespace-nowrap text-[13px] leading-tight text-muted-foreground">{c.title}</span>
              </div>
              <div className="mt-2.5 flex h-8 shrink-0 items-center">
                {loading ? <Skeleton className="h-7 w-24" /> : <div className="font-mono text-[22px] font-bold leading-tight tabular-nums tracking-tight text-slate-800">{c.value}</div>}
              </div>
              <div className="mt-1.5 flex-1 text-[11px] leading-relaxed text-muted-foreground">{c.desc}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 消耗趋势 + 模型 TOP */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">消耗趋势</CardTitle>
            <CardDescription>按天 Token · {from} ~ {to}{rangeSum ? ` · 合计 ${fmtFull(rangeSum.tokens)}` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-72 w-full" /> : trendSpec ? <div className="h-72"><ChartLazy spec={trendSpec} /></div> : <div className="flex h-72 items-center justify-center text-muted-foreground">暂无数据</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">模型消耗 TOP 10</CardTitle>
            <CardDescription>按 Token · 点击可查看全部分析{topSum ? ` · TOP10 合计 ${fmtFull(topSum.tokens)}` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-72 w-full" /> : topSpec ? <div className="h-72"><ChartLazy spec={topSpec} /></div> : <div className="flex h-72 items-center justify-center text-muted-foreground">暂无数据</div>}
          </CardContent>
        </Card>
      </div>

      <div className="text-[11px] text-muted-foreground">
        统计口径:chat 输入 + 输出 token,不含 embedding。区间合计 {fmtFull(rangeSum?.tokens ?? 0)} tokens。
      </div>
    </div>
  )
}
