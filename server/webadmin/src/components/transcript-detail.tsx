// LLM 对话审计：筛选契约、状态徽章与详情弹窗。
//
// 2026-10 按产品要求精简：管理员要看的只有两件事 —— 用户发了什么、模型回了什么。
// 审计内容明文留存，服务端直接给出可读文本（request_text / response_text），
// 这里不再解析系统消息/工具调用，也没有"解密"状态。
import { useEffect, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { copyText } from '../lib/clipboard'
import { useFlash } from '../lib/use-flash'
import { Check, Copy } from 'lucide-react'

/** 列表/详情共用的行形态（`serverstore.LLMTranscript` + 服务端补的 username/user_deleted）。 */
export interface TranscriptRowDto {
  id: number
  request_id: string
  user_id?: number
  endpoint?: string
  model?: string
  status_code?: number
  response_bytes?: number
  response_sha256?: string
  audit_status?: string
  created_at?: string
  completed_at?: string
  duration_ms?: number
  stream?: boolean
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  provider?: string
  session_id?: string
  workspace?: string
  error_type?: string
  error_message?: string
  username?: string
  user_deleted?: boolean
  request_body?: string
}

/** `GET /audit/transcripts/:id` 的响应。 */
export interface TranscriptDetailDto {
  transcript: TranscriptRowDto
  request: string
  response: string
  /** 服务端提取的可读文本：用户发了什么 / 模型回了什么（认不出形状时即原文）。 */
  request_text?: string
  response_text?: string
}

/**
 * 列表/导出的筛选条件（**输入态与已应用态共用同一形态**）。
 *
 * 用户用 `userId` 而不是用户名：服务端 `?user_id=` 只接受数字 id
 * （需求 §8.2「按用户筛选」），界面如实按 id 筛，不为一个输入框去查全量用户列表。
 * 日期用日期控件产出的 `YYYY-MM-DD`，服务端 until 取当天结束。
 */
export interface TranscriptFilters {
  model: string
  endpoint: string
  userId: string
  sessionId: string
  keyword: string
  since: string
  until: string
}

export const EMPTY_TRANSCRIPT_FILTERS: TranscriptFilters = {
  model: '', endpoint: '', userId: '', sessionId: '', keyword: '', since: '', until: '',
}

/**
 * 由筛选条件拼查询串，**列表与导出共用**（服务端 `parseTranscriptFilter` 也是同一份）。
 *
 * offset/limit 只在列表时传：导出按需求 §8.2 走自己的 5000 行上限，
 * 传了 limit 反而会与服务端上限打架（"列表看到 N 条、导出却是另一批"）。
 */
export function buildTranscriptQuery(filters: TranscriptFilters, offset?: number, limit?: number): string {
  const params = new URLSearchParams()
  if (offset !== undefined) params.set('offset', String(offset))
  if (limit !== undefined) params.set('limit', String(limit))
  for (const [key, value] of [
    ['model', filters.model],
    ['endpoint', filters.endpoint],
    ['user_id', filters.userId],
    ['session_id', filters.sessionId],
    ['keyword', filters.keyword],
    ['since', filters.since],
    ['until', filters.until],
  ] as const) {
    const trimmed = value.trim()
    if (trimmed) params.set(key, trimmed)
  }
  return params.toString()
}

/** 审计态徽章语义（服务端取值：complete / incomplete / write_failed / pending）。 */
const AUDIT_STATUS_META: Record<string, { label: string; variant: 'success' | 'destructive' | 'secondary' | 'outline' }> = {
  complete: { label: '已完成', variant: 'success' },
  // 断流：上游没给收尾标记就断了。**必须与 complete 一眼可辨** —— 需求 §8.3
  // 要求"中途断流时保存已收到内容，并标记为 incomplete"，若两态同形，
  // 管理员会把截断的响应当成完整响应读。
  incomplete: { label: '断流·未正常结束', variant: 'destructive' },
  write_failed: { label: '审计写入失败', variant: 'destructive' },
  pending: { label: '进行中', variant: 'secondary' },
}

export function auditStatusMeta(status?: string): { label: string; variant: 'success' | 'destructive' | 'secondary' | 'outline' } {
  const key = (status ?? '').trim()
  return AUDIT_STATUS_META[key] ?? { label: key || '未知', variant: 'outline' }
}

/** 审计态徽章（列表与详情共用，避免两处各写一份颜色判定）。 */
export function AuditStatusBadge({ status }: { status?: string }) {
  const meta = auditStatusMeta(status)
  return (
    <Badge variant={meta.variant} title={`audit_status=${status ?? ''}`} data-status={status ?? ''}>
      {meta.label}
    </Badge>
  )
}

/**
 * 一段可折叠、可复制的正文。
 *
 * 需求 §8.3「查看全文必须有明确反馈」：此前是 `max-h-64 overflow-auto` —— 长内容
 * 能滚但没有"查看全文"的入口，需求点名要修。这里给出显式的「展开全文 / 收起」
 * 与「复制」，复制成功按钮文字短暂变「已复制」（失败则明说，不假装成功）。
 */
export function TranscriptCollapsible({ title, text, testId }: { title: string; text: string; testId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [flashMsg, flash] = useFlash()

  // flash 自动清空时把按钮文案复位（"短暂变已复制"而非永久）。
  useEffect(() => {
    if (flashMsg === '') setCopied(false)
  }, [flashMsg])

  const copy = async () => {
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      flash('已复制')
    } else {
      setCopied(false)
      flash('复制失败，请手动选择文本复制')
    }
  }

  const empty = text.trim() === ''
  return (
    <div data-testid={testId}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">{title}</span>
        {!empty && (
          <>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '收起' : '展开全文'}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void copy()}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? '已复制' : '复制'}
            </Button>
            {flashMsg !== '' && flashMsg !== '已复制' && (
              <span role="status" aria-live="polite" className="text-[11px] text-destructive">{flashMsg}</span>
            )}
            {!expanded && <span className="text-[11px] text-muted-foreground">内容较长，已折叠</span>}
          </>
        )}
      </div>
      {empty ? (
        <p className="rounded bg-muted/40 p-3 text-xs text-muted-foreground">（无内容）</p>
      ) : (
        <pre
          data-expanded={expanded ? 'true' : 'false'}
          className={`overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs ${expanded ? 'max-h-[70vh]' : 'max-h-56'}`}
        >{text}</pre>
      )}
    </div>
  )
}


/** 详情弹窗：只展示用户请求与模型回复（Audit.tsx 只管打开/关闭与取数）。 */
export function TranscriptDetailDialog({
  open,
  onOpenChange,
  detail,
  busy,
  error,
  onExportJson,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: TranscriptDetailDto | null
  busy: boolean
  error: string
  onExportJson: () => void
}) {
  const row = detail?.transcript
  const who = row ? (row.user_deleted ? '已删除用户' : row.username || `用户 #${row.user_id ?? ''}`) : ''
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>对话详情</DialogTitle>
          <DialogDescription>
            {row ? `${who} · ${row.model || '未知模型'} · ${row.created_at ? new Date(row.created_at).toLocaleString() : ''}` : '用户的请求与模型的回复'}
          </DialogDescription>
        </DialogHeader>
        {busy && <p role="status" className="text-sm text-muted-foreground">正在读取…</p>}
        {error && <p role="alert" className="text-sm text-destructive">读取详情失败：{error}</p>}
        {detail && row && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AuditStatusBadge status={row.audit_status} />
              {row.error_message && <span className="text-xs text-destructive">{row.error_message}</span>}
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={onExportJson}>导出 JSON</Button>
              </div>
            </div>
            <TranscriptCollapsible title="用户请求" text={detail.request_text ?? detail.request} testId="transcript-prompt" />
            <TranscriptCollapsible title="模型回复" text={detail.response_text ?? detail.response} testId="transcript-response" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
