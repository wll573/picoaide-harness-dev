import { useCallback, useEffect, useRef, useState } from 'react'
import type { ISpec } from '@visactor/vchart'
import { ChartLazy } from '../../components/chart-lazy'
import { request, ADMIN_API } from '../../api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { PageHeader } from '../../components/page-header'
import { CircleDollarSign, Activity, Coins, Landmark } from 'lucide-react'
import { RangeFilter, defaultRange, sumRows, type OverviewData } from './common'
import { fmtTokens, fmtFull } from '../../lib/format'

// 总览(主页面):单位整体 Token 用量 + 近30天趋势 + 模型 TOP10
// 2026-10 内网交付口径：主路径不展示 ¥ / 花费 / 余额 / 上游账户余额卡。
// cost 字段仍在 OverviewData 接口里保留（兼容对账），本页不再读取。
export default function UsageOverview() {
  const init = defaultRange()
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // P2-46: 请求序号防乱序——快速切换区间时只有最新请求的响应能写 state。
  const loadSeq = useRef(0)

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
  }, [])

  useEffect(() => { void load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rangeSum = data ? sumRows(data.trend) : null
  const topSum = data ? sumRows(data.top_models) : null

  // KPI 主口径 = **Token**（请求数可并存）。
  const kpis = data ? [
    { title: '本月 Token', value: fmtTokens(data.month.tokens), desc: `本月请求 ${data.month.requests.toLocaleString()}`, icon: Landmark },
    { title: '今日 Token', value: fmtTokens(data.today.tokens), desc: `今日请求 ${data.today.requests.toLocaleString()}`, icon: Activity },
    { title: '区间 Token', value: fmtTokens(rangeSum!.tokens), desc: `chat 输入+输出，不含 embedding`, icon: Coins },
    { title: '区间请求', value: rangeSum!.requests.toLocaleString(), desc: `${from} ~ ${to}`, icon: CircleDollarSign },
  ] : []

  // UsageRow 没有聚合 tokens 字段，逐行用 prompt+completion。
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
      <PageHeader title="用量总览" desc="单位整体 Token 用量：本月、今日、区间用量 / 消耗趋势 / 模型排行" />

      <RangeFilter from={from} to={to} setFrom={setFrom} setTo={setTo} onQuery={(f, t) => void load(f, t)} />

      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* KPI 行:Token 为第一指标；不渲染上游账户余额 / ¥ */}
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
