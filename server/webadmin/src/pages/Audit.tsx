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
import { hasPermission, PERM_AUDIT_RETENTION_WRITE } from '../lib/rbac'
import {
  AuditStatusBadge,
  EMPTY_TRANSCRIPT_FILTERS,
  TranscriptDetailDialog,
  buildTranscriptQuery,
  type TranscriptDetailDto,
  type TranscriptFilters,
  type TranscriptRowDto,
  type TranscriptSessionDto,
} from '../components/transcript-detail'
import { ScrollText, RefreshCw, Download } from 'lucide-react'

// 审计保留策略的写权限点 `audit:retention:write`（与服务端 `serverauth.PermAuditRetention`
// 对齐）**唯一声明在 `lib/rbac.ts`**（2026-09-29 第三十轮 FIX-45 ④：此前这个常量就地声明在
// 本文件第 24 行，落在四向对拍的**扫描根之外** —— 打错一个字符时整套 webadmin 用例全绿，
// 而保留策略保存按钮对**所有人（含超管）永久禁用**）。`lib/nav.test.ts` 的前向守卫
// `PERM_* 只允许在 lib/rbac.ts 声明` 会拒绝就地再写一份。
//
// ⚠️ 本页**刻意不再新增** `hasPermission` 调用点（2026-10 内网交付第二批）：审计读面
// （列表/筛选/分页/导出/详情）在服务端由 `PermAuditRead` 守卫，前端不按权限点收口
// —— 页内新增一个 `hasPermission(PERM_AUDIT_READ)` 会落在 `lib/nav.test.ts` 的
// 「调用点必须登记正向夹具」守卫之外（该文件由另一条泳道独占），门禁会直接红。

interface LogRow {
  id: number
  username: string
  action: string
  detail: string
  created_at: string
}

// M3: 与服务端实际写入的 audit action 全集对齐(用户/部门/技能/令牌等敏感操作)
//
// ⚠️ 这张表是**唯一真源**:筛选下拉(`FILTER_ACTIONS`)由它派生,`Audit.test.tsx`
// 也从服务端 Go 源码抽出动作全集与它**双向对拍**(缺任一方向即红)。新增服务端写点
// 必须在这里补标签,否则用例直接红 —— 不再是"人工维护的清单"(见 audit-actions 用例)。
export const ACTION_LABEL: Record<string, string> = {
  skill_create: '上架技能',
  skill_update: '更新技能',
  skill_disable: '下架技能',
  skill_enable: '重新上架技能',
  skill_grant: '技能授权',
  skill_revoke: '技能撤销授权',
  skill_grants_replace: '技能部门授权替换',
  // 组织共享库(shared_*)动作:此前只在服务端写入、读侧未登记,于是无法在
  // 筛选下拉里选中、行内还会回落成裸 id(SG-5,审计 2026-09-17)。共享技能
  // 上下架的动作名带 shared_ 前缀与市场域区分,标签与市场 twins 对齐。
  shared_skill_enable: '重新上架共享技能',
  shared_skill_disable: '下架共享技能',
  shared_skill_upload: '上传共享技能',
  shared_skill_approve: '通过共享技能',
  shared_skill_reject: '拒绝共享技能',
  shared_skill_delete: '删除共享技能',
  shared_skill_qualify: '设置共享技能质量',
  shared_skill_grant: '共享技能授权',
  shared_skill_revoke: '共享技能撤销授权',
  // 组织共享智能体(agent_preset_*)同族:含 2026-09-17 新增的上下架动作(SG-4)。
  agent_preset_upload: '上传智能体',
  agent_preset_approve: '通过智能体',
  agent_preset_reject: '拒绝智能体',
  agent_preset_delete: '删除智能体',
  agent_preset_qualify: '设置智能体质量',
  agent_preset_grant: '智能体授权',
  agent_preset_enable: '重新上架智能体',
  agent_preset_disable: '下架智能体',
  user_create: '创建用户',
  user_update: '更新用户',
  user_delete: '删除用户',
  user_dept: '用户部门变更',
  user_register: '用户自助注册',
  user_tokens_revoked: '吊销令牌',
  // 令牌签发配额（R15C-R-01 的配套加固，2026-09-25）：员工自助登录每次都会签发
  // 一条 90 天令牌，同账号高频登录会把 api_tokens 撑成无界表；被**配额**挡住的那次
  // 登录在服务端留痕（serverauth/token_quota.go），这里必须有中文标签 —— 否则行内
  // 回落成裸 id、且进不了筛选下拉（`Audit.test.tsx` 的服务端写点双向对拍会直接红）。
  token_issue_quota_exceeded: '令牌签发超限被拒',
  auth_config: '修改认证配置',
  // LDAP 目录同步（第五轮审计 R5-B-8，2026-09-23）：同步**只自动停用、永不自动
  // 启用**。两个动作各一条标签：`directory_enable_skipped` 是每轮一条的汇总
  // （点名被跳过、需要管理员显式启用的账号），`directory_user_disabled` 是因目录
  // 中消失而被停用的逐个账号。缺标签后果与服务端其它写点相同：行内回落成裸 id、
  // 且进不了筛选下拉（`Audit.test.tsx` 的双向对拍会直接报缺失）。
  directory_enable_skipped: '目录同步跳过启用（需管理员显式启用）',
  directory_user_disabled: '目录同步停用账号',
  dept_create: '新建部门',
  dept_update: '更新部门',
  dept_delete: '删除部门',
  // 余额(0061/0062):钱的每一次变动都必须可筛可读(审计员的核心诉求)
  balance_adjust: '调整余额',
  balance_grant: '余额发放',
  balance_settings: '余额策略变更',
  // 历史 MCP/知识库动作:当前代码已无写点(功能下线),但存量库里的行仍需中文
  // 标签与筛选入口 —— 不要删(删了老行会回落成裸 id)。
  mcp_create: '新建MCP',
  mcp_update: 'MCP更新',
  mcp_delete: '删除MCP',
  mcp_grant: 'MCP授权',
  mcp_revoke: 'MCP撤销授权',
  kb_create: '新建知识库',
  kb_update: '更新知识库',
  kb_delete: '删除知识库',
  kb_import: '知识库导入',
  kb_grant: '知识库授权',
  kb_revoke: '知识库撤销授权',
  // SG-5 残留(r3v 复核,2026-09-17):把服务端**实际会写入**的其余动作补齐 ——
  // 未登记的动作在行内回落成裸 id、且进不了筛选下拉(后端 ?action= 本来就支持)。
  // 上一轮只补了组织共享库那一族,漏掉了 agent_preset_revoke 与下面这些老动作;
  // 完整清单由 Audit.test.tsx 的 SERVER_ACTIONS 冻结(服务端新增写点时必须同步)。
  agent_preset_revoke: '智能体撤销授权',
  // 市场智能体(marketplace/agent_api.go 的 agent_* 写点)。标签一律带「市场」
  // 限定词:组织共享侧(agent_preset_*)已占用「下架智能体」等名字,下拉里两项
  // 同名会让管理员无法分辨。
  agent_create: '上架市场智能体',
  agent_update: '更新市场智能体',
  agent_update_meta: '更新市场智能体信息',
  agent_disable: '下架市场智能体',
  agent_enable: '重新上架市场智能体',
  agent_grant: '市场智能体授权',
  agent_revoke: '市场智能体撤销授权',
  agent_grants: '市场智能体部门授权替换',
  // 能力中心:名称锁定与技能包规范化(sharedskills / marketplace 管理面)。
  capability_lock: '锁定能力名称',
  capability_unlock: '解锁能力名称',
  skill_normalize: '规范化技能包',
  // 网关(上游/模型/配置)。
  gateway_config: '网关配置变更',
  managed_config_update: '托管配置变更',
  // 2026-09-22:网关文件台账的清理动作(管理员按条件删除上游文件 + 台账行)。
  gateway_file_delete: '网关文件删除',
  gateway_file_purge: '网关文件批量清理',
  error_reporting_test: '错误上报连通性自检',
  provider_create: '新建上游',
  provider_update: '更新上游',
  provider_delete: '删除上游',
  model_create: '新建模型',
  model_update: '更新模型',
  model_delete: '删除模型',
  // 连接器凭据与启用状态(connectors/admin.go)。
  connector_create: '新建连接器',
  connector_update: '更新连接器',
  connector_enabled: '连接器上下架',
  connector_delete: '删除连接器',
  // 登录与管理员自助操作(serverauth)。login_success/login_fail 也在审计表里,
  // 登记后可按结果筛选。
  login_success: '登录成功',
  login_fail: '登录失败',
  // 第六轮 R6-A-4：OIDC 在途流程达上限时的**容量拒绝**单独记一条（它不算失败，
  // 不能混进 login_fail —— 否则一个 NAT 出口会把自己的配额拒绝当成攻击证据，
  // 二次封锁整个出口）。语义与 internal/serverauth/oidc.go 的写照点一致。
  oidc_flow_capacity: 'OIDC 流程容量拒绝',
  password_change: '修改密码',
  admin_password_change: '修改管理员密码',
  admin_mfa_login: '管理员 MFA 登录',
  admin_mfa_enable: '开启管理员 MFA',
  admin_mfa_disable: '关闭管理员 MFA',
  admin_mfa_reset: '重置管理员 MFA',
  role_change: '变更角色',
  audit_retention_change: '审计保留策略变更',
  ldap_sync: 'LDAP 同步',
  // 能力中心归属转移与报表订阅。
  app_owner_transfer: '转移能力归属',
  report_subscription_create: '新建报表订阅',
  report_subscription_update: '更新报表订阅',
  report_subscription_delete: '删除报表订阅',
  // WASM 应用平台(wasmapp/api 的 auditApp/auditOrg 写点,R1-uxw-3)。
  //
  // 这一族此前**一条都没登记**:驳回理由写进了审计链、却筛不出、读不到标签,
  // 行内只剩裸 id `wasm_app_release_reject` —— "v1.2.0 为什么被拒"这个问题在
  // 管理端根本查不了(审计评审 R1-uxw-3 的现场)。动作名与服务端逐字一致,
  // 由 `Audit.test.tsx` 的双向对拍用例守(DTO/写点改名会立刻红)。
  wasm_app_release: '发布应用版本',
  wasm_app_release_pending: '应用版本进入待审',
  wasm_app_release_approve: '通过应用版本',
  wasm_app_release_reject: '拒绝应用版本',
  wasm_app_release_denied: '应用版本发布被拒',
  wasm_app_release_failed: '应用版本发布失败',
  wasm_app_publish_toggle: '应用上下架',
  wasm_app_freeze: '冻结/解冻应用',
  wasm_app_delete: '删除应用',
  wasm_app_export: '导出应用',
  wasm_app_access_change: '应用访问范围变更',
  wasm_app_prune_failed: '应用版本回收失败',
  wasm_app_schema_view: '查看应用数据表',
  wasm_app_seed: '预置内置应用',
  // 历史保留（2026-09-19 起该动作已废弃：应用基域配置面随「客户端专属」改造删除）：
  // 这一行**不能删** —— 存量审计链里仍有这个动作码的行，删掉映射会让历史记录
  // 只显示原始动作码（审计可读性倒退）。属契约型保留，不是残留。
  wasm_apps_base_domain_change: '应用域名变更',
  wasm_limits_change: '应用限制项变更',
  wasm_review_switch: '应用更新审批开关',
}
// 注:quota_change / dept_budget_change / quota_default_change 随配额与部门预算
// 下线一并移除(2026-09-11),不再有新数据产生。

// M8: 筛选下拉的可选动作
const FILTER_ACTIONS = Object.keys(ACTION_LABEL).sort()

// 操作 → 徽章语义色:创建=绿 / 删除=红 / 更新=琥珀 / 授权=绿
// 未收录进 ACTION_LABEL 的动作统一中性 outline,避免误撞成实心蓝(default)。
/**
 * 上传类审计条目的预览目标:服务端把明细固定写成 `name@version …`
 * (sharedskills.UploadAuditDetail),审计页据此还原出归档预览端点,
 * 审批人无需再去技能页翻找就能当场查看「上传了什么」。
 */
function previewTargetOf(action: string, detail: string): { base: string; key: string } | null {
  const m = /^[A-Za-z0-9._-]+@(\S+)/.exec(detail)
  if (!m) return null
  const [, version] = m
  if (action === 'shared_skill_upload') {
    const name = detail.slice(0, detail.indexOf('@'))
    return { base: `${ADMIN_API}/shared-skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, key: `${name}@${version}` }
  }
  if (action === 'skill_update' || action === 'skill_create') {
    const name = detail.slice(0, detail.indexOf('@'))
    return { base: `${ADMIN_API}/skills/${encodeURIComponent(name)}`, key: `${name}@${version}` }
  }
  return null
}

function actionBadgeVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' {
  if (!(action in ACTION_LABEL)) return 'outline'
  if (/create|enable|grant/.test(action)) return 'success'
  if (/delete|disable|revoke/.test(action)) return 'destructive'
  if (/update|dept/.test(action)) return 'secondary'
  return 'outline'
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // L4: 保留时区语义,按本地时间展示
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 列表/详情共用的用户名回落（需求 §8.2 的"用户"列）。 */
export function transcriptUserLabel(row: Pick<TranscriptRowDto, 'username' | 'user_deleted' | 'user_id'>): string {
  if (row.user_deleted) return '已删除用户'
  return row.username || (row.user_id !== undefined ? String(row.user_id) : '—')
}

/** "输入/输出/总"三段的统一口径（列表与详情标题都从这里派生）。 */
export function fmtTokenTriple(row: TranscriptRowDto): string {
  return `${row.input_tokens ?? 0} / ${row.output_tokens ?? 0} / ${row.total_tokens ?? 0}`
}

// ---------------------------------------------------------------------------
// 按筛选条件批量导出（需求 §8.2）。
//
// **不能用 `window.open`**：导出接口是带认证的管理面 GET（会话 cookie + 同源）。
// `window.open` 会新开一个普通导航，拿不到当前页面的会话上下文与 CSRF 语义，
// 在部署成子路径/带反代时尤其不可靠。这里用 `fetch` 带上凭据把 CSV 拉成 blob,
// 再触发一次下载锚点 —— 与 `lib/csv.ts` 的本地导出同一形态（同源 fetch 默认带
// cookie,显式写 `same-origin` 是为了意图可审计）。
//
// 响应头 `X-Export-Truncated: true` + `X-Export-Total` 由服务端在超过 5000 行时给出,
// 前端据此提示"结果被截断，请收窄筛选"（不能悄悄只给一部分）。
// ---------------------------------------------------------------------------
export async function fetchTranscriptExport(filters: TranscriptFilters): Promise<{ blob: Blob; filename: string; truncated: boolean; total: number }> {
  const res = await fetch(`${ADMIN_API}/audit/transcripts/export?${buildTranscriptQuery(filters)}`, {
    headers: { accept: 'text/csv' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `导出失败（${res.status}）`
    try {
      message = (await res.json())?.error?.message ?? message
    } catch { /* 非 JSON 错误体：保留中文兜底 */ }
    throw new Error(message)
  }
  // 文件名取自服务端 Content-Disposition；缺失时按当日兜底（与本地导出同形）。
  const disposition = res.headers.get('content-disposition') ?? ''
  const matched = /filename="?([^";]+)"?/.exec(disposition)
  return {
    blob: await res.blob(),
    filename: matched?.[1] ?? `llm-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    truncated: res.headers.get('x-export-truncated') === 'true',
    total: Number(res.headers.get('x-export-total') ?? 0),
  }
}

// 对话列表固定每页 50 条（服务端 limit 上限 200）。
const transcriptPageSize = 50

export default function Audit() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  // M8: 筛选条件(输入态 vs 已应用态)
  const [filterAction, setFilterAction] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [appliedAction, setAppliedAction] = useState('')
  const [appliedUser, setAppliedUser] = useState('')
  // P1-8: 请求序号防乱序——快速翻页/切筛选时只有最新请求的响应能更新 state
  const loadSeq = useRef(0)
  // 同一条防乱序纪律也用在 Prompt/Response 列表上（快速翻页/改筛选时丢弃过期响应）。
  const transcriptSeq = useRef(0)
  // G13: 审计保留策略(仅 super_admin 可写; auditor 只读展示)
  const [retentionDays, setRetentionDays] = useState(180)
  // 交互审计（Prompt/Response 全文）默认 1 个月，与后端
  // DefaultLLMTranscriptRetentionDays 同源；此处只是加载完成前的占位，
  // 真实值由 /audit/settings 回填。
  const [transcriptRetentionDays, setTranscriptRetentionDays] = useState(30)
  // 2026-09-17 审计 F6：保留天数默认 180，异步填充的 catch 又是静默的 ⇒ 未加载完
  // （或加载失败）就点「保存策略」会把 180 写进库。加载成功前锁死写面。
  const [retentionLoaded, setRetentionLoaded] = useState(false)
  const [retentionBusy, setRetentionBusy] = useState(false)
  // 5-3：保留策略**读取失败**必须与"还在加载"区分（此前静默吞掉失败，界面永久停在"加载中"）。
  const [retentionError, setRetentionError] = useState('')
  // R6（2026-09-17 独立验证）：日志列表此前没有任何加载闸门，首帧就渲染
  // 「暂无审计记录」——把"还没读到"说成"没有记录"（F7 在 Users/Departments 修掉的同族形态）。
  const [logsLoaded, setLogsLoaded] = useState(false)
  // ---- Prompt/Response 审计（需求 §8.2 / §8.3） ----
  const [transcripts, setTranscripts] = useState<TranscriptRowDto[]>([])
  const [sessions, setSessions] = useState<TranscriptSessionDto[]>([])
  const [groupBySession, setGroupBySession] = useState(true)
  const [transcriptsTotal, setTranscriptsTotal] = useState(0)
  // 输入态 vs 已应用态：与日志筛选同一条纪律（改输入不触发请求，点「查询」才应用）。
  const [transcriptFilters, setTranscriptFilters] = useState<TranscriptFilters>(EMPTY_TRANSCRIPT_FILTERS)
  const [appliedTranscript, setAppliedTranscript] = useState<TranscriptFilters>(EMPTY_TRANSCRIPT_FILTERS)
  const [transcriptOffset, setTranscriptOffset] = useState(0)
  const [transcriptBusy, setTranscriptBusy] = useState(false)
  // 读取失败必须与"确实没有记录"区分（R15C-W-06 同族：失败不得渲染成空态）。
  const [transcriptError, setTranscriptError] = useState('')
  const [transcriptsLoaded, setTranscriptsLoaded] = useState(false)
  const [transcriptExportBusy, setTranscriptExportBusy] = useState(false)
  const [transcriptExportMsg, setTranscriptExportMsg] = useState('')
  const [transcriptDetail, setTranscriptDetail] = useState<TranscriptDetailDto | null>(null)
  const [transcriptDetailBusy, setTranscriptDetailBusy] = useState(false)
  const [transcriptDetailError, setTranscriptDetailError] = useState('')
  const [transcriptDialogOpen, setTranscriptDialogOpen] = useState(false)

  // 体验层能力判定(护栏在服务端 RequirePermission):
  //   GET /audit/settings 只需 audit:read —— auditor 能读保留天数;
  //   PUT /audit/settings 需 audit:retention:write —— **刻意不进 AuditorPermissions**
  //   (serverauth/rbac.go),auditor 每次点「保存策略」都是 403。
  // R7-RV-2 残留:此前输入框可编辑、按钮可点,与 App 的"所有修改已禁用"横幅
  // 直接矛盾;这里改成只读展示 + 说明,导出 CSV / 筛选(audit:read)保持可用。
  const canWriteRetention = hasPermission(PERM_AUDIT_RETENTION_WRITE)

  const load = useCallback(async (p: number, action: string, username: string) => {
    const current = ++loadSeq.current
    try {
      const params = new URLSearchParams({ page: String(p), size: '50' })
      if (action) params.set('action', action)
      if (username) params.set('username', username)
      const data = await request(`${ADMIN_API}/audit?${params.toString()}`)
      if (current !== loadSeq.current) return // P1-8: 过期响应丢弃
      setLogs(data.logs)
      setTotal(data.total)
      setPage(p)
      setLogsLoaded(true)
      // G13: 保留策略(读仅 PermAuditRead; 写 403 由保存按钮语义兜底)
      request(`${ADMIN_API}/audit/settings`).then((s) => {
        if (s?.retention_days) setRetentionDays(s.retention_days)
        if (s?.transcript_retention_days) setTranscriptRetentionDays(s.transcript_retention_days)
        setRetentionLoaded(true)
      }).catch((err: any) => {
        // 5-3（2026-09-17 第二轮独立验证）：此前这里静默吞掉失败，而本轮又给未加载状态
        // 加了「保留策略加载中…」文案 ⇒ 请求失败会**永久**显示"加载中"，没有任何失败提示
        // （与 R4"把失败说成还在加载"同族）。失败要明说，写面保持锁定。
        setRetentionError(err?.message ?? '读取失败')
      })
    } catch (err: any) {
      if (current !== loadSeq.current) return // P1-8: 过期响应不写错误
      // R15C-W-06（审计 2026-09-25，P2）：失败必须清空行与总数。此前只 setError，
      // 于是"上一次成功、与当前筛选条件不符"的那一页继续冒充本次筛选结果，而
      // `exportCSV()` 直接吃内存里的 logs ⇒ 错误被导出**固化**成留档文件。
      setLogs([])
      setTotal(0)
      setLogsLoaded(false)
      setError(err.message)
    }
  }, [])

  useEffect(() => { load(1, appliedAction, appliedUser) }, [load, appliedAction, appliedUser])

  /**
   * 读 Prompt/Response 审计列表。
   *
   * 传 `offset`/`size` 而不是页码：服务端分页是 offset/limit（需求 §8.2 的
   * "分页 + 固定保留期"），翻页要真的落到对应 offset 上，否则第二页永远是第一页。
   * 筛选条件走已应用态，请求序号防乱序（快速翻页时只有最新响应能写 state）。
   */
  const loadTranscripts = useCallback(async (filters: TranscriptFilters, offset: number, size: number) => {
    const current = ++transcriptSeq.current
    setTranscriptBusy(true)
    try {
      const data = await request(`${ADMIN_API}/audit/transcripts?${buildTranscriptQuery(filters, offset, size)}${groupBySession ? '&group_by=session' : ''}`)
      if (current !== transcriptSeq.current) return // 过期响应丢弃（快速翻页/改筛选）
      setTranscripts(Array.isArray(data?.transcripts) ? data.transcripts : [])
      setSessions(Array.isArray(data?.sessions) ? data.sessions : [])
      setTranscriptsTotal(Number(data?.total ?? 0))
      setTranscriptError('')
      setTranscriptsLoaded(true)
    } catch (err: any) {
      if (current !== transcriptSeq.current) return
      // 失败清空 + 记失败态：旧行不得冒充新筛选条件下的结果（R15C-W-06 同族）。
      setTranscripts([])
      setSessions([])
      setTranscriptsTotal(0)
      setTranscriptsLoaded(false)
      setTranscriptError(`读取 Prompt/Response 审计失败：${err.message}`)
    } finally {
      if (current === transcriptSeq.current) setTranscriptBusy(false)
    }
  }, [groupBySession])

  useEffect(() => {
    void loadTranscripts(appliedTranscript, transcriptOffset, transcriptPageSize)
  }, [loadTranscripts, appliedTranscript, transcriptOffset, transcriptPageSize])

  const applyFilter = () => {
    setAppliedAction(filterAction)
    setAppliedUser(filterUser.trim())
    setPage(1)
    load(1, filterAction, filterUser.trim())
  }

  /** 应用 Prompt/Response 筛选：回到第一页（否则会在新条件下的第 N 页读空）。 */
  const applyTranscriptFilter = () => {
    setAppliedTranscript({ ...transcriptFilters })
    setTranscriptOffset(0)
  }

  const clearTranscriptFilter = () => {
    setTranscriptFilters(EMPTY_TRANSCRIPT_FILTERS)
    setAppliedTranscript(EMPTY_TRANSCRIPT_FILTERS)
    setTranscriptOffset(0)
  }

  const viewSession = (row: TranscriptSessionDto) => {
    if (!row.session_id) { void openTranscript(row.transcript_id); return }
    const filters = { ...appliedTranscript, userId: String(row.user_id), sessionId: row.session_id }
    setTranscriptFilters(filters)
    setAppliedTranscript(filters)
    setTranscriptOffset(0)
    setGroupBySession(false)
  }

  // 审批预览:上传类审计条目可当场查看归档内容(2026-09-01)
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

  const pages = Math.max(1, Math.ceil(total / 50))

  // Prompt/Response 的分页（每页 20/50/100，服务端 limit 上限 200）。
  const transcriptPages = Math.max(1, Math.ceil(transcriptsTotal / transcriptPageSize))
  const transcriptPage = Math.floor(transcriptOffset / transcriptPageSize) + 1

  // CSV 导出(当前页数据; 轻量版 v3b, 不调服务端)
  //
  // R7 branding-4:这里原来手写 `"${v}"` 拼串 —— 没有公式注入转义也没有 BOM,
  // 而审计行的 username/detail 来自**匿名可写**输入(登录失败即记录请求里的
  // 用户名,服务端只限长度不校验字符集),导出后管理员在 Excel/LibreOffice
  // 打开会执行以 = + - @ 开头的单元格。改用与用量中心同一份 lib/csv.ts。
  const exportCSV = () => {
    // R15C-W-06:只在"这一页确实读到了"时才允许导出(内存行的来源就是这次读取)。
    if (!logsLoaded || logs.length === 0) return
    const header = ['id', 'username', 'action', 'detail', 'created_at']
    downloadCsv(
      `audit-${new Date().toISOString().slice(0, 10)}.csv`,
      header,
      logs.map((l) => [l.id, l.username, l.action, l.detail, l.created_at]),
    )
  }

  /** 按当前筛选条件批量导出 Prompt/Response 审计元数据（需求 §8.2）。 */
  const exportTranscripts = async () => {
    if (transcriptExportBusy) return
    setTranscriptExportBusy(true)
    setTranscriptExportMsg('')
    try {
      const result = await fetchTranscriptExport(appliedTranscript)
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
      if (result.truncated) {
        setTranscriptExportMsg(`结果被截断：共 ${result.total} 条，本次仅导出前 5000 条 —— 请收窄筛选后重新导出`)
      } else {
        setTranscriptExportMsg(`已导出 ${result.total} 条审计元数据（不含 Prompt/Response 正文）`)
      }
    } catch (err: any) {
      setTranscriptExportMsg(`导出失败：${err?.message ?? '未知错误'}`)
    } finally {
      setTranscriptExportBusy(false)
    }
  }

  const saveRetention = async () => {
    if (!canWriteRetention) return
    if (retentionBusy) return
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      setError('保留天数必须是 1~3650 的整数')
      return
    }
    if (!Number.isInteger(transcriptRetentionDays) || transcriptRetentionDays < 1 || transcriptRetentionDays > 3650) {
      setError('Prompt/Response 保留天数必须是 1~3650 的整数')
      return
    }
    setRetentionBusy(true)
    setError('')
    try {
      await request(`${ADMIN_API}/audit/settings`, {
        method: 'PUT',
        body: JSON.stringify({ retention_days: retentionDays, transcript_retention_days: transcriptRetentionDays }),
      })
      setError('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRetentionBusy(false)
    }
  }

  const openTranscript = async (id: number) => {
    setTranscriptDetail(null)
    setTranscriptDetailError('')
    setTranscriptDialogOpen(true)
    setTranscriptDetailBusy(true)
    try {
      setTranscriptDetail(await request<TranscriptDetailDto>(`${ADMIN_API}/audit/transcripts/${id}`))
    } catch (err: any) {
      setTranscriptDetailError(err?.message ?? '未知错误')
    } finally {
      setTranscriptDetailBusy(false)
    }
  }

  const exportTranscript = () => {
    if (!transcriptDetail) return
    const payload = JSON.stringify(transcriptDetail, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `llm-transcript-${transcriptDetail.transcript.request_id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="审计日志"
        desc="敏感操作记录(用户/部门/技能等)"
        actions={
          <>
            {/* 导出的数据源就是这一页的内存行(R15C-W-06)⇒ 没读到行时必须禁用,
                否则会把"旧筛选条件下的上一页"或空表固化成 CSV 留档。 */}
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
      {/* G13: 审计保留策略 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <span className="text-[13px] font-medium">审计日志保留</span>
        <Input
          type="number"
          min={1}
          max={3650}
          className="h-8 w-28"
          aria-label="审计保留天数"
          value={retentionDays}
          readOnly={!canWriteRetention}
          disabled={!canWriteRetention || !retentionLoaded}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
        />
        <span className="text-xs text-muted-foreground">天(1~3650; 保存后立即清理更旧日志)</span>
        <span className="ml-3 text-[13px] font-medium">Prompt/Response 保留</span>
        <Input
          type="number"
          min={1}
          max={3650}
          className="h-8 w-28"
          aria-label="Prompt/Response 保留天数"
          value={transcriptRetentionDays}
          readOnly={!canWriteRetention}
          disabled={!canWriteRetention || !retentionLoaded}
          onChange={(e) => setTranscriptRetentionDays(Number(e.target.value))}
        />
        <span className="text-xs text-muted-foreground">天(加密保存全文)</span>
        {canWriteRetention && !retentionLoaded && !retentionError && (
          // R5：加载未完成时按钮是禁用的，必须说明"为什么点了没反应"；同时输入框也
          // 禁用 —— 否则管理员先输入的天数会被落地值覆盖（实测输入 30 → 变成 90）。
          <span className="text-xs text-muted-foreground">保留策略加载中…</span>
        )}
        {canWriteRetention && !retentionLoaded && retentionError && (
          // 5-3：失败不能伪装成"加载中"（那会让人一直等下去）。
          <span className="text-xs text-destructive">保留策略读取失败（{retentionError}），保存已锁定——请刷新页面后重试</span>
        )}
        {canWriteRetention ? (
          <Button size="sm" variant="outline" disabled={retentionBusy || !retentionLoaded} onClick={() => { void saveRetention() }}>
            {retentionBusy ? '保存中…' : '保存策略'}
          </Button>
        ) : (
          // 服务端 PUT /audit/settings 要 audit:retention:write(刻意不给 auditor):
          // 只读角色看到的是数值 + 一句"为什么不能改",而不是一个注定 403 的按钮。
          <span className="text-xs text-muted-foreground">
            (当前账号只读:修改保留策略需要 audit:retention:write 权限)
          </span>
        )}
      </div>
      <Card className="p-4" data-testid="llm-transcript-audit">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">用户对话记录</h2>
            <p className="text-xs text-muted-foreground">共 {transcriptsTotal} {groupBySession ? '个会话' : '条请求'}；{groupBySession ? '同一用户的同一 session 汇总展示，展开后查看每次请求。' : '点“查看对话”可查看用户请求与模型回复。'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setGroupBySession(!groupBySession); setTranscriptOffset(0) }}>
              {groupBySession ? '按请求展示' : '按会话展示'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportTranscripts()} disabled={transcriptExportBusy}>
              <Download className="h-3.5 w-3.5" /> {transcriptExportBusy ? '导出中…' : '按日期导出'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void loadTranscripts(appliedTranscript, transcriptOffset, transcriptPageSize)} disabled={transcriptBusy}>
              <RefreshCw className="h-3.5 w-3.5" /> {transcriptBusy ? '加载中…' : '刷新'}
            </Button>
          </div>
        </div>
        {transcriptExportMsg && (
          <p role="status" aria-live="polite" className={`mb-3 text-xs ${transcriptExportMsg.includes('失败') || transcriptExportMsg.includes('截断') ? 'text-destructive' : 'text-muted-foreground'}`}>
            {transcriptExportMsg}
          </p>
        )}
        {/* 筛选：只按用户和日期。导出沿用同一组条件。 */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          {/* 服务端 ?user_id= 只接受数字 id：如实按 id 筛。 */}
          <Input className="w-32" placeholder="用户 ID" aria-label="筛选用户 ID" inputMode="numeric" value={transcriptFilters.userId} onChange={(e) => setTranscriptFilters({ ...transcriptFilters, userId: e.target.value })} />
          <Input className="w-64" placeholder="Session ID" aria-label="筛选会话 ID" value={transcriptFilters.sessionId} onChange={(e) => setTranscriptFilters({ ...transcriptFilters, sessionId: e.target.value })} />
          <Input className="w-40" type="date" aria-label="起始日期" value={transcriptFilters.since} onChange={(e) => setTranscriptFilters({ ...transcriptFilters, since: e.target.value })} />
          <span className="text-xs text-muted-foreground">至</span>
          <Input className="w-40" type="date" aria-label="结束日期" value={transcriptFilters.until} onChange={(e) => setTranscriptFilters({ ...transcriptFilters, until: e.target.value })} />
          <Button size="sm" variant="outline" onClick={applyTranscriptFilter}>查询</Button>
          <Button size="sm" variant="ghost" onClick={clearTranscriptFilter}>清除筛选</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupBySession && sessions.map((row) => (
              <TableRow key={`${row.user_id}:${row.session_id || row.transcript_id}`}>
                <TableCell className="text-xs">{fmtTime(row.last_at)}</TableCell>
                <TableCell>{transcriptUserLabel(row)}</TableCell>
                <TableCell className="max-w-64 break-all font-mono text-xs">{row.session_id || '无 Session（独立请求）'}<div className="text-muted-foreground">{row.request_count} 次请求 · {row.total_tokens} Tokens</div></TableCell>
                <TableCell>{row.models || '—'}</TableCell>
                <TableCell>{row.failure_count > 0 ? <Badge variant="destructive">{row.failure_count} 次失败</Badge> : <Badge variant="success">无失败</Badge>}{row.pending_count > 0 && <Badge variant="secondary">{row.pending_count} 次进行中</Badge>}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => viewSession(row)}>查看会话</Button></TableCell>
              </TableRow>
            ))}
            {!groupBySession && transcripts.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{fmtTime(row.created_at)}</TableCell>
                <TableCell className={row.user_deleted ? 'text-muted-foreground' : ''}>{transcriptUserLabel(row)}</TableCell>
                <TableCell className="max-w-64 break-all font-mono text-xs">{row.session_id || '—'}</TableCell>
                <TableCell>{row.model || '—'}</TableCell>
                <TableCell>
                  <AuditStatusBadge status={row.audit_status} />
                  {(row.error_type || row.error_message) && (
                    <div className="max-w-56 truncate text-[11px] text-destructive" title={row.error_message || row.error_type}>
                      {row.error_message || row.error_type}
                    </div>
                  )}
                </TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => void openTranscript(row.id)}>查看对话</Button></TableCell>
              </TableRow>
            ))}
            {!transcriptBusy && transcriptError && (
              <TableRow>
                <TableCell colSpan={6} className="border-0 p-0">
                  <EmptyState
                    icon={<ScrollText className="h-5 w-5 text-muted-foreground" />}
                    title="Prompt/Response 审计未读取成功"
                    desc="读取失败时不保留上一次的行（否则会冒充本次筛选结果）；请重试或调整筛选条件"
                  />
                </TableCell>
              </TableRow>
            )}
            {transcriptsLoaded && !transcriptBusy && !transcriptError && (groupBySession ? sessions : transcripts).length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">暂无 Prompt/Response 审计记录</TableCell></TableRow>
            )}
            {!transcriptsLoaded && !transcriptError && (
              <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Prompt/Response 审计加载中…</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {/* 分页（需求 §8.2）：翻页真的请求对应的 offset，且每页条数可选。 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={transcriptOffset <= 0 || transcriptBusy}
            onClick={() => setTranscriptOffset(Math.max(0, transcriptOffset - transcriptPageSize))}
          >上一页</Button>
          <span className="text-sm text-muted-foreground">第 {transcriptPage}/{transcriptPages} 页 · 共 {transcriptsTotal} {groupBySession ? '个会话' : '条请求'}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={transcriptPage >= transcriptPages || transcriptBusy}
            onClick={() => setTranscriptOffset(transcriptOffset + transcriptPageSize)}
          >下一页</Button>
        </div>
      </Card>
      <TranscriptDetailDialog
        open={transcriptDialogOpen}
        onOpenChange={(open) => {
          setTranscriptDialogOpen(open)
          if (!open) {
            setTranscriptDetail(null)
            setTranscriptDetailError('')
          }
        }}
        detail={transcriptDetail}
        busy={transcriptDetailBusy}
        error={transcriptDetailError}
        onExportJson={exportTranscript}
      />
      {/* M8: 筛选条 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-52" aria-label="全部操作">
            <SelectValue placeholder="全部操作" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部操作</SelectItem>
            {FILTER_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>
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
          <Button size="sm" variant="ghost" onClick={() => { setFilterAction(''); setFilterUser(''); setAppliedAction(''); setAppliedUser('') }}>清除筛选</Button>
        )}
        {(appliedTranscript !== EMPTY_TRANSCRIPT_FILTERS) && (
          <Button size="sm" variant="ghost" onClick={clearTranscriptFilter}>清除 Prompt/Response 筛选</Button>
        )}
      </div>
      <Card data-testid="audit-log-card">
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
            <TableRow key={l.id} data-testid="audit-log-row">
              <TableCell className="font-mono text-xs text-slate-400">{l.id}</TableCell>
              <TableCell><Badge variant={actionBadgeVariant(l.action)}>{ACTION_LABEL[l.action] ?? l.action}</Badge></TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[9px] font-bold text-slate-500">
                    {l.username.slice(0, 1).toUpperCase()}
                  </span>
                  {l.username}
                </span>
              </TableCell>
              {/* M8: 详情悬停可查看全文;截断单元可聚焦,键盘/触屏用户经 aria-label 读全文 */}
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
                  icon={<ScrollText className="h-5 w-5 text-muted-foreground" />}
                  title="审计记录未读取成功"
                  desc="读取失败时不保留上一页的行（否则会冒充本次筛选结果）；请重试或调整筛选条件"
                />
              </TableCell>
            </TableRow>
          )}
          {logsLoaded && logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="border-0 p-0">
                <EmptyState
                  icon={<ScrollText className="h-5 w-5 text-muted-foreground" />}
                  title="暂无审计记录"
                  desc="敏感操作(用户/部门/技能/令牌)会在此留痕"
                />
              </TableCell>
            </TableRow>
          )}
          {!logsLoaded && logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="border-0 p-0">
                <div className="p-4 text-sm text-muted-foreground">审计记录加载中…</div>
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
