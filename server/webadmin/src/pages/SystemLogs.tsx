import { useCallback, useEffect, useRef, useState } from 'react'
import { request, ADMIN_API } from '../api'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { PageHeader } from '../components/page-header'
import { EmptyState } from '../components/empty-state'
import { ArchivePreviewDialog, ArchivePreviewData } from '../components/archive-preview-dialog'
import { Card } from '../components/ui/card'
import { downloadCsv } from '../lib/csv'
import { FileClock, RefreshCw, Download } from 'lucide-react'

// ===========================================================================
// 系统日志页（需求 §8.1：敏感操作日志从交互审计里拆出来）
//
// 需求原文：**登录、登出、系统健康检查、后台任务、Key 切换和普通管理操作不得混入
// 交互审计列表**，要保留的系统事件放独立的系统日志页面。此前这些动作
// （login_success / login_fail / admin_mfa_login / password_change / user_* /
// gateway_config …）与 Prompt/Response 全文审计挤在同一个 `Audit.tsx` 页面里。
//
// 本页数据源与服务端接口 **与审计页完全同一条**
// （`GET /api/server/admin/audit`：page/size/action/username 筛选 + 分页），
// 只是把"系统事件"这一类操作日志单独呈现；后端契约一个字没改。
//
// ---------------------------------------------------------------------------
// 过渡期说明（本轮拆分由多个 agent 并行做，`Audit.tsx` 由另一个 agent 独占）
//
// 下面这几个纯函数/常量在本页各有一份实现：
//   · SENSITIVE_ACTION_LABEL —— 本页需要的中文动作标签
//   · previewTargetOf / actionBadgeVariant / fmtTime
// 它们**与 Audit.tsx 里的同名实现并存**，这是拆分过渡期的有意取舍：
//   ① 本页刻意**不从 Audit.tsx import** —— 那会把本页耦合到别人正在改的文件上；
//   ② 也不放弃实现改而依赖对方 —— 那本页当场不可用。
// 拆分完成后，这几项应**合并到 `lib/`**（`ACTION_LABEL` 也应收敛成一份真源，
// `lib/audit-sinks.spec.ts` / `Audit.test.tsx` 已在对拍那张表）。
// ===========================================================================

interface LogRow {
  id: number
  username: string
  action: string
  detail: string
  created_at: string
}

/**
 * 本页用到的动作中文标签（**只覆盖系统事件这一族**）。
 *
 * 与 `Audit.tsx` 的 `ACTION_LABEL` 在拆分过渡期并存（见文件头说明）。动作 id 与
 * 服务端 `internal/serverauth`、`internal/managedconfig`、`internal/llmgateway`
 * 的实际写点逐字一致；未登记的 action 在行内回落成裸 id（与审计页同行为）。
 */
export const SENSITIVE_ACTION_LABEL: Record<string, string> = {
  // 登录 / 登出（serverauth/handler.go、admin.go、oidc.go）
  login_success: '登录成功',
  login_fail: '登录失败',
  // OIDC 在途流程达上限时的**容量拒绝**（serverauth/oidc.go）。它不算失败，
  // 不能混进 login_fail —— 否则一个 NAT 出口会把自己的配额拒绝当成攻击证据。
  oidc_flow_capacity: 'OIDC 流程容量拒绝',
  user_register: '用户自助注册',
  // 令牌签发配额挡住的那次登录（serverauth/token_quota.go）。
  token_issue_quota_exceeded: '令牌签发超限被拒',
  user_tokens_revoked: '吊销令牌',
  // 管理员自助（serverauth/admin.go）
  password_change: '修改密码',
  admin_password_change: '修改管理员密码',
  admin_mfa_login: '管理员 MFA 登录',
  admin_mfa_enable: '开启管理员 MFA',
  admin_mfa_disable: '关闭管理员 MFA',
  admin_mfa_reset: '重置管理员 MFA',
  role_change: '变更角色',
  auth_config: '修改认证配置',
  audit_retention_change: '审计保留策略变更',
  // LDAP 目录同步（serverauth/dirsync.go）。同步**只自动停用、永不自动启用**：
  // `directory_enable_skipped` 是每轮一条的汇总，`directory_user_disabled` 是逐账号停用。
  ldap_sync: 'LDAP 同步',
  directory_enable_skipped: '目录同步跳过启用（需管理员显式启用）',
  directory_user_disabled: '目录同步停用账号',
  // 普通管理操作（llmgateway/admin.go、managedconfig/handlers.go、llmgateway/errorreporting_test_event.go）
  gateway_config: '网关配置变更',
  managed_config_update: '托管配置变更',
  error_reporting_test: '错误上报连通性自检',
}

/** 筛选下拉的可选动作（由标签表派生，避免两处清单漂移）。 */
const FILTER_ACTIONS = Object.keys(SENSITIVE_ACTION_LABEL).sort()

/**
 * 上传类审计条目的预览目标：服务端把明细固定写成 `name@version …`，
 * 据此还原归档预览端点，管理员无需再去技能页翻找就能当场查看「上传了什么」。
 *
 * 与 `Audit.tsx` 的同名实现并存（过渡期；见文件头）。
 */
function previewTargetOf(action: string, detail: string): { base: string; key: string } | null {
  const m = /^([A-Za-z0-9._-]+)@(\S+)/.exec(detail)
  if (!m) return null
  const [, name, version] = m
  if (action === 'shared_skill_upload') {
    return { base: `${ADMIN_API}/shared-skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, key: `${name}@${version}` }
  }
  if (action === 'skill_update' || action === 'skill_create') {
    return { base: `${ADMIN_API}/skills/${encodeURIComponent(name)}`, key: `${name}@${version}` }
  }
  return null
}

/** 操作 → 徽章语义色：创建/启用/授权=绿，删除/停用/撤销/失败=红，更新=琥珀，其余中性。 */
function actionBadgeVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' {
  if (!(action in SENSITIVE_ACTION_LABEL)) return 'outline'
  if (/fail|delete|disable|revoke|reset/.test(action)) return 'destructive'
  if (/create|enable|grant|login|register|sync|_ok/.test(action)) return 'success'
  if (/update|change|config/.test(action)) return 'secondary'
  return 'outline'
}

/** 本地时区展示时间（保留时区语义，不转 UTC）。 */
function fmtTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

export default function SystemLogs() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  // 筛选条件（输入态 vs 已应用态）
  const [filterAction, setFilterAction] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [appliedAction, setAppliedAction] = useState('')
  const [appliedUser, setAppliedUser] = useState('')
  // 请求序号防乱序：快速翻页/切筛选时只有最新请求的响应能更新 state。
  const loadSeq = useRef(0)
  // 列表加载闸门：首帧不得把"还没读到"渲染成"暂无系统日志"。
  const [logsLoaded, setLogsLoaded] = useState(false)

  // 审批预览：上传类条目可当场查看归档内容。
  const [preview, setPreview] = useState<ArchivePreviewData | null>(null)
  const [previewKey, setPreviewKey] = useState('')
  const [previewBase, setPreviewBase] = useState('')
  const openPreview = async (base: string, key: string) => {
    setPreviewBase(base)
    setPreviewKey(key)
    setPreview(null)
    try {
      setPreview(await request<ArchivePreviewData>(`${base}/preview`))
    } catch (e) {
      setError(`预览失败:${(e as Error).message}`)
      setPreviewKey('')
    }
  }

  const load = useCallback(async (p: number, action: string, username: string) => {
    const current = ++loadSeq.current
    try {
      const params = new URLSearchParams({ page: String(p), size: '50' })
      if (action) params.set('action', action)
      if (username) params.set('username', username)
      const data = await request(`${ADMIN_API}/audit?${params.toString()}`)
      if (current !== loadSeq.current) return // 过期响应丢弃
      setLogs(data.logs)
      setTotal(data.total)
      setPage(p)
      setLogsLoaded(true)
    } catch (err: any) {
      if (current !== loadSeq.current) return // 过期响应不写错误
      // 失败必须清空行与总数：否则"上一次成功、与当前筛选条件不符"的那一页会继续
      // 冒充本次筛选结果，而导出直接吃内存里的 logs ⇒ 错误被固化进留档文件。
      setLogs([])
      setTotal(0)
      setLogsLoaded(false)
      setError(err.message)
    }
  }, [])

  useEffect(() => { load(1, appliedAction, appliedUser) }, [load, appliedAction, appliedUser])

  const applyFilter = () => {
    setAppliedAction(filterAction)
    setAppliedUser(filterUser.trim())
    setPage(1)
    load(1, filterAction, filterUser.trim())
  }

  const pages = Math.max(1, Math.ceil(total / 50))

  /**
   * 导出**当前页**为 CSV（轻量版，不调服务端）。
   *
   * 用 `lib/csv.ts` 的 downloadCsv：它已处理公式注入（`= + - @ Tab CR` 前缀中和）
   * 与 UTF-8 BOM。这里的 username/detail 来自**匿名可写**输入（登录失败即记录请求
   * 里的用户名），不能手写拼串。
   */
  const exportCSV = () => {
    // 只在"这一页确实读到了"时才允许导出（内存行的来源就是这次读取）。
    if (!logsLoaded || logs.length === 0) return
    const header = ['id', 'username', 'action', 'detail', 'created_at']
    downloadCsv(
      `system-logs-${new Date().toISOString().slice(0, 10)}.csv`,
      header,
      logs.map((l) => [l.id, l.username, l.action, l.detail, l.created_at]),
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="系统日志"
        desc="登录/登出、管理员自助与普通管理操作留痕（与 Prompt/Response 交互审计分列）"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportCSV} disabled={!logsLoaded || logs.length === 0}>
              <Download className="h-3.5 w-3.5" /> 导出 CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => load(page, appliedAction, appliedUser)}>
              <RefreshCw className="h-3.5 w-3.5" /> 刷新
            </Button>
          </>
        }
      />
      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* 筛选条：按操作 / 操作者（服务端 ?action= 精确匹配、?username=） */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="全部操作" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部操作</SelectItem>
            {FILTER_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{SENSITIVE_ACTION_LABEL[a]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-44"
          placeholder="操作者"
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilter() }}
        />
        <Button size="sm" variant="outline" onClick={applyFilter}>筛选</Button>
        {(appliedAction || appliedUser) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setFilterAction(''); setFilterUser(''); setAppliedAction(''); setAppliedUser('') }}
          >清除筛选</Button>
        )}
      </div>

      <Card data-testid="system-log-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>详情</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id} data-testid="system-log-row">
                <TableCell className="font-mono text-xs text-slate-400">{l.id}</TableCell>
                <TableCell><Badge variant={actionBadgeVariant(l.action)}>{SENSITIVE_ACTION_LABEL[l.action] ?? l.action}</Badge></TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[9px] font-bold text-slate-500">
                      {l.username.slice(0, 1).toUpperCase()}
                    </span>
                    {l.username}
                  </span>
                </TableCell>
                {/* 详情悬停可查看全文；截断单元可聚焦，键盘/触屏用户经 aria-label 读全文 */}
                <TableCell
                  className="max-w-96 truncate font-mono text-xs text-slate-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title={l.detail}
                  tabIndex={0}
                  aria-label={l.detail}
                >
                  {l.detail}
                  {(() => {
                    const target = previewTargetOf(l.action, l.detail)
                    return target === null ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 h-5 px-1.5 text-[11px]"
                        onClick={() => void openPreview(target.base, target.key)}
                      >预览</Button>
                    )
                  })()}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{fmtTime(l.created_at)}</TableCell>
              </TableRow>
            ))}
            {!logsLoaded && error && (
              <TableRow>
                <TableCell colSpan={5} className="border-0 p-0">
                  <EmptyState
                    icon={<FileClock className="h-5 w-5 text-muted-foreground" />}
                    title="系统日志未读取成功"
                    desc="读取失败时不保留上一页的行（否则会冒充本次筛选结果）；请重试或调整筛选条件"
                  />
                </TableCell>
              </TableRow>
            )}
            {logsLoaded && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="border-0 p-0">
                  <EmptyState
                    icon={<FileClock className="h-5 w-5 text-muted-foreground" />}
                    title="暂无系统日志"
                    desc="登录/登出、管理员自助与普通管理操作会在此留痕"
                  />
                </TableCell>
              </TableRow>
            )}
            {!logsLoaded && logs.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={5} className="border-0 p-0">
                  <div className="p-4 text-sm text-muted-foreground">系统日志加载中…</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <ArchivePreviewDialog
          openKey={previewKey}
          data={preview}
          mainTitle="SKILL.md"
          mainContent={preview?.skill_md ?? ''}
          fileBase={previewBase}
          onClose={() => { setPreviewKey(''); setPreview(null) }}
        />
      </Card>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => load(page - 1, appliedAction, appliedUser)}>上一页</Button>
        <span className="text-sm text-muted-foreground">第 {page}/{pages} 页 · 共 {total} 条</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => load(page + 1, appliedAction, appliedUser)}>下一页</Button>
      </div>
    </div>
  )
}
