/**
 * 网关模型 provider（DSH 0.1.7 的注册面）。
 *
 * 背景（两层，缺一不可）：
 *  · **0.1.6**：上游给 `llm-deepseek` 加了 `protocol`（缺省 `messages`），messages 适配器
 *    只发 `x-api-key`、不发 `Authorization`，而本仓网关 `/v1/*` 挂在 `serverauth.BearerAuth`
 *    下（只认 `Authorization: Bearer`）⇒ 每个模型请求 401「缺少认证令牌」（2026-09-22 现场
 *    事故）。当时的修法是在组装期钉死 `protocol: chat-completions`。
 *  · **0.1.7-rc.2**：`protocol` **被删除**（`llm-deepseek/src/config.ts:207`，配了直接抛错），
 *    上游适配器只剩 Messages 一条路径。因此这里使用本插件自己的 Chat Completions
 *    adapter，直接请求网关的 `/v1/chat/completions`。
 *
 * 所以本插件不使用上游的 Messages provider（也不使用它的 x-api-key 鉴权），用同一份
 * Config 形状注册同一个 provider 路由 `deepseek-official`，把**会话令牌作为 Bearer** 交给请求。
 * 组装期 `cordis.patch.yml` 把上游那一行 `disabled` 掉并插入本行（id `picoaide-gateway-llm`）。
 *
 * 令牌来源是 `credentials` 服务（`gateway-model.ts` 在会话变化时写入 `TOKEN_ENV`），
 * **不再**经过 `apiKeyEnv`：0.1.7 的 base `llm-deepseek` Config 里没有这个键，而
 * `SettingsForms.write` 对非 volatile 字段会直接抛 `Config field "apiKeyEnv" is not volatile`。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  assertUsableApiKey,
  attributionHeaders,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { catalogModelInfo, Config, plainOptions, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { GATEWAY_LLM_ROW_ID, TOKEN_ENV } from './gateway-contract.ts'

export { Config, GATEWAY_LLM_ROW_ID, TOKEN_ENV }

/** Stable Cordis plugin name. */
export const name = 'gateway-llm'

/** Services consumed: the LLM registry and the credential store holding the gateway token. */
export const inject = ['llm', 'credentials']

/** The provider route `bootstrap.ts` points `agent-default-model` at. */
const PROVIDER = 'deepseek-official'

/**
 * 端点绑定失败的错误码（不在上游 `DEFAULT_RETRYABLE_CODES` 里 ⇒ 不做无谓重试：
 * 端点不会自己变对，重试只会把令牌再举一次）。
 */
export const ENDPOINT_MISMATCH_CODE = 'ENDPOINT_MISMATCH'

/**
 * 把一个网关地址归一成可比较的形状（`origin + 去尾斜杠的 pathname`）。
 *
 * 用 `URL` 解析而不是字符串比较：`https://HOST/v1` 与 `https://host/v1/` 是同一个端点，
 * 而 `https://host/v1/../v2`、带 userinfo 的地址、非法地址都必须**判不出来**（返回
 * `undefined` ⇒ fail-closed）。
 * @param value - 候选网关地址。
 * @returns 归一化后的端点，或 `undefined`（不可解析 ⇒ 调用方必须拒绝）。
 */
export function normalizeGatewayEndpoint(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username !== '' || url.password !== '') return undefined
    const path = url.pathname.replace(/\/+$/u, '')
    return `${url.origin}${path === '' ? '' : path}`
  } catch {
    return undefined
  }
}

/**
 * 当前会话允许把网关令牌送到的**唯一**端点。
 *
 * 基准是**当前会话的 `serverURL`**（员工登录的那台企业服务器），不是任何编译期字面量：
 * 渠道包把网关放在自己的域名下时，`defaults.server_url` 就是 `serverURL`，因此这条推导
 * 天然覆盖"渠道自己的网关"；管理员把网关搬到**别的**主机属于需要显式声明的合法异址
 * （见本模块末尾的取舍说明）。
 * @param serverURL - `ctx.picoSession.getSession()?.serverURL`。
 * @returns 归一化的 `<serverURL>/v1`，会话缺席/地址非法时 `undefined`（= 拒绝）。
 */
export function allowedGatewayEndpoint(serverURL: string | null | undefined): string | undefined {
  const origin = normalizeGatewayEndpoint(serverURL ?? undefined)
  return origin === undefined ? undefined : `${origin}/v1`
}

/**
 * 硬边界：网关令牌只允许发给**当前会话的网关端点**。
 *
 * 为什么是 fail-closed（2026-09-28 UPG-4 认账残留的收口）：`gateway-model.ts` 在登录时
 * 把 `<serverURL>/v1` 写进行设置，登出时清空；但"已登录 + 设置写入失败"（数据根里的孤儿
 * 写锁、磁盘满、进程被杀）以及"登出后设置没清干净"这两种组合下，`baseURL` 可能是**旧值
 * 或回落值**，而凭据仍在 —— 那时请求会把员工令牌发到那个端点。员工令牌只应发给我们自己的
 * 网关：这不是功能开关，是安全边界，所以判据放在**发请求之前**、且在读取凭据之前。
 * @param baseURL - 本次请求实际要打的端点（`connection.baseURL`）。
 * @param allowed - {@link allowedGatewayEndpoint} 的结果。
 * @returns 可诊断的拒绝理由（点名两端、不含令牌），或 `undefined`（放行）。
 */
export function endpointMismatch(baseURL: string | undefined, allowed: string | undefined): string | undefined {
  const actual = normalizeGatewayEndpoint(baseURL)
  if (allowed === undefined) {
    return 'gateway-llm: refusing to send the gateway token because no signed-in session declares a gateway endpoint;'
      + ' sign in first (the session server URL is the trust anchor for the token)'
  }
  if (actual === undefined) {
    return `gateway-llm: refusing to send the gateway token to an unusable endpoint ${JSON.stringify(String(baseURL))};`
      + ` the signed-in session's gateway is ${allowed}`
  }
  if (actual !== allowed) {
    return `gateway-llm: refusing to send the gateway token to ${actual};`
      + ` the signed-in session's gateway is ${allowed}`
  }
  return undefined
}

/**
 * The failure a wrong row id would cause, or `undefined` when the row is the one
 * this plugin and `gateway-model.ts`/`bootstrap.ts` agree on.
 *
 * 行 id 就是设置命名空间（0.1.7 的 `SettingsForms` 按 profile 条目 id 找表单），而
 * `gateway-model.ts`/`bootstrap.ts` 按 {@link GATEWAY_LLM_ROW_ID} 写入同一个命名空间。
 * 行被改名时立即失败，而不是让"写进一个不存在的命名空间"在登录后才炸
 * （`No configurable plugin entry "…"`）。Loader 之外的挂载（单元测试）没有条目 id，
 * 这时按"无法判定"放行。
 * @param entryId - `ctx.fiber.entry?.options.id`, when this plugin runs as a profile row.
 * @returns the failure message, or `undefined` when the row id is acceptable.
 */
export function rowIdFailure(entryId: string | undefined): string | undefined {
  if (entryId === undefined || entryId === GATEWAY_LLM_ROW_ID) return undefined
  return `gateway-llm: this row must keep the id "${GATEWAY_LLM_ROW_ID}" (found "${entryId}");`
    + ' the settings namespace the gateway writes baseURL/models to is the row id'
}

/**
 * Register the gateway as the `deepseek-official` OpenAI Chat Completions provider.
 *
 * `baseURL`/`models`/`reasoningEffort` stay in the row's settings section,
 * written by `gateway-model.ts` (login) and `bootstrap.ts` (catalog).
 */
export function apply(ctx: Context, config: Config): void {
  const rowFailure = rowIdFailure(ctx.fiber.entry?.options.id)
  if (rowFailure !== undefined) throw new Error(rowFailure)
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  // 组装期即解析一次：配置非法（例如有人把删除掉的 `protocol` 加回来）在装载时就响亮失败，
  // 而不是等到第一次对话。
  options()
  const ref = credentialRef(TOKEN_ENV)
  // 失败语义：抛出的错误由适配器透传（`LlmError` 原样上抛，其它被包成 TRANSPORT），
  // 请求**不会**发出去 —— 缺令牌时是"没有请求"而不是"一个无凭据的请求"。
  const resolveAuth = async (connection: { baseURL?: string }): Promise<{ headers: Record<string, string> }> => {
    // 硬边界先于凭据解析：端点不对时**连令牌都不读**（读也不发，但少一次凭据面接触）。
    const session = ctx.get('picoSession')?.getSession?.() ?? null
    const refusal = endpointMismatch(connection?.baseURL, allowedGatewayEndpoint(session?.serverURL))
    if (refusal !== undefined) throw new LlmError(refusal, ENDPOINT_MISMATCH_CODE)
    const hit = await ctx.credentials.resolve(ref)
    if (hit === undefined) {
      throw new LlmError(
        `gateway-llm: no gateway token for provider route "${PROVIDER}"; sign in so the session`
        + ` service stores ${ref} in the credentials service`,
        'MISSING_CREDENTIAL',
      )
    }
    const token = assertUsableApiKey(hit.value, 'gateway-llm', ref)
    return { headers: { Authorization: `Bearer ${token}` } }
  }
  const adapter = new GatewayChatCompletionsAdapter({
    options,
    providerName: 'DeepSeek',
    resolveAuth,
    discoverModels: provider => Promise.resolve(options().models.map(model => catalogModelInfo(provider, model))),
  })
  ctx.llm.registerAdapter([PROVIDER], adapter)
  // 与上游 api-key 行同面：把 provider 关联到**本行**的设置表单（表单值就是行 config）。
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: ctx.fiber.entry?.options.id ?? GATEWAY_LLM_ROW_ID, settingsPath: [] },
  ])
}

type GatewayOptions = ReturnType<typeof resolveAdapterOptions>
type ResolveAuth = (connection: { baseURL?: string }) => Promise<{ headers: Record<string, string> }>

const OFF_REASONING_EFFORT = ReasoningEffortId('off')
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')

const ALL_REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
  { id: LOW_REASONING_EFFORT, name: 'Low', description: 'Prefer for routine or latency-sensitive tasks.' },
  { id: HIGH_REASONING_EFFORT, name: 'High', description: 'The default balance for most tasks.' },
  { id: MAX_REASONING_EFFORT, name: 'Max', description: 'Reserve for the hardest quality-first tasks.' },
] as const

const OFF_ONLY_REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
] as const

/**
 * Build reasoning capability info from connection defaults.
 *
 * When thinking is disabled, only "off" is offered. When enabled, all four
 * levels are exposed and the configured default (or high as fallback) becomes
 * the default effort. The per-model bootstrap patch overrides this further for
 * models that have an explicit `_thinking_adapter`.
 */
function resolveReasoningInfo(
  thinking: 'enabled' | 'disabled' | undefined,
  defaultEffort: 'off' | 'low' | 'high' | 'max' | undefined,
) {
  if (thinking === 'disabled') {
    return { efforts: OFF_ONLY_REASONING_EFFORTS, defaultEffort: OFF_REASONING_EFFORT }
  }
  const resolvedDefault = defaultEffort === 'off'
    ? OFF_REASONING_EFFORT
    : defaultEffort === 'low'
      ? LOW_REASONING_EFFORT
      : defaultEffort === 'max'
        ? MAX_REASONING_EFFORT
        : HIGH_REASONING_EFFORT
  return { efforts: ALL_REASONING_EFFORTS, defaultEffort: resolvedDefault }
}

/**
 * Small provider adapter for the server's `/v1/chat/completions` endpoint.
 *
 * DSH 0.1.7's bundled DeepSeek adapter is Messages-only. Keeping this adapter
 * local lets the enterprise gateway use the server's OpenAI-compatible route
 * without downgrading the whole DSH dependency graph or sending Anthropic
 * headers/payloads.
 */
class GatewayChatCompletionsAdapter extends LlmAdapter {
  private readonly options: () => GatewayOptions
  private readonly providerName: string
  private readonly resolveAuth: ResolveAuth
  private readonly discoverModels: (provider: string) => Promise<readonly LlmModelInfo[]>

  constructor(dependencies: {
    options: () => GatewayOptions
    providerName: string
    resolveAuth: ResolveAuth
    discoverModels: (provider: string) => Promise<readonly LlmModelInfo[]>
  }) {
    super()
    this.options = dependencies.options
    this.providerName = dependencies.providerName
    this.resolveAuth = dependencies.resolveAuth
    this.discoverModels = dependencies.discoverModels
  }

  providerInfo(provider: string) {
    return { id: provider, name: this.providerName }
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.discoverModels(provider)
  }

  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const opts = this.options()
    const match = opts.models.find(item => item.id === model)
    return {
      provider,
      id: model,
      name: match?.name ?? model,
      ...(match?.description === undefined ? {} : { description: match.description }),
      ...(match?.inputModalities === undefined ? {} : { inputModalities: match.inputModalities }),
      context: { contextWindow: match?.contextWindow ?? opts.defaultContextWindow },
      defaultMaxTokens: opts.maxTokens,
      reasoning: resolveReasoningInfo(opts.defaults.thinking, opts.defaults.reasoningEffort),
    }
  }

  async prepareCall(provider: string, model: string): Promise<{ model: LlmResolvedModelInfo, stream: (options: GenerateOptions) => AsyncIterable<StreamChunk> }> {
    const resolved = await this.resolveModel(provider, model)
    return { model: resolved, stream: options => this.stream(options) }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config = this.options()
    const baseURL = config.baseURL?.replace(/\/+$/u, '')
    const auth = await this.resolveAuth({ baseURL })
    const messages = options.messages.map(message => projectMessage(message))
    if (options.system !== undefined && !messages.some(message => message.role === 'system')) {
      messages.unshift({ role: 'system', content: options.system })
    }
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (options.tools?.length) body.tools = options.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    else if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens
    if (options.stop?.length) body.stop = options.stop
    if (options.reasoningEffort !== undefined && options.reasoningEffort !== 'off') body.reasoning_effort = options.reasoningEffort

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      redirect: 'error',
      body: JSON.stringify(body),
      headers: {
        ...attributionHeaders(),
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...auth.headers,
        ...(options.sessionId === undefined ? {} : { 'x-deepseek-harness-session-id': String(options.sessionId) }),
        ...(options.purpose === 'compaction' ? { 'x-deepseek-harness-compact': '1' } : {}),
      },
    })
    if (!response.ok) {
      const text = await response.text()
      let detail = text
      try { detail = JSON.stringify(JSON.parse(text)) } catch { /* keep text */ }
      throw new LlmError(`Gateway Chat Completions request failed (${response.status}): ${detail}`, `HTTP_${response.status}`, { status: response.status })
    }
    if (response.body === null) throw new LlmError('Gateway Chat Completions returned no response body', 'EMPTY_RESPONSE')

    let textStarted = false
    let text = ''
    let reasoningStarted = false
    let reasoning = ''
    const blockOrder: number[] = []
    let finishReason: 'stop' | 'tool-calls' | 'max-tokens' = 'stop'
    const toolState = new Map<number, { id: string, name: string, arguments: string }>()
    for await (const data of readSseData(response.body)) {
      if (data === '[DONE]') break
      let chunk: any
      try { chunk = JSON.parse(data) } catch { continue }
      const usage = chunk.usage
      if (usage && typeof usage === 'object') {
        yield { type: 'usage', usage: { inputTokens: Number(usage.prompt_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0), totalTokens: Number(usage.total_tokens ?? 0) } }
      }
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        if (!reasoningStarted) { reasoningStarted = true; blockOrder.push(1); yield { type: 'block-start', index: 1, blockType: 'reasoning' } }
        reasoning += delta.reasoning_content
        yield { type: 'reasoning-delta', index: 1, text: delta.reasoning_content }
      }
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        if (!textStarted) { textStarted = true; blockOrder.push(0); yield { type: 'block-start', index: 0, blockType: 'text' } }
        text += delta.content
        yield { type: 'text-delta', index: 0, text: delta.content }
      }
      for (const [offset, call] of (delta?.tool_calls ?? []).entries()) {
        const index = Number(call.index ?? offset) + 1
        const current = toolState.get(index) ?? { id: String(call.id ?? ''), name: String(call.function?.name ?? ''), arguments: '' }
        if (call.id) current.id = String(call.id)
        if (call.function?.name) current.name += String(call.function.name)
        const argumentsDelta = String(call.function?.arguments ?? '')
        if (!toolState.has(index)) yield { type: 'block-start', index, blockType: 'tool-call' }
        toolState.set(index, current)
        if (argumentsDelta) { current.arguments += argumentsDelta; yield { type: 'tool-call-delta', index, id: current.id as never, name: current.name, argumentsDelta } }
      }
      const reason = choice?.finish_reason
      if (reason === 'tool_calls') finishReason = 'tool-calls'
      else if (reason === 'length') finishReason = 'max-tokens'
    }
    for (const index of blockOrder) {
      if (index === 0) yield { type: 'block-end', index, block: { type: 'text', text } }
      else yield { type: 'block-end', index, block: { type: 'reasoning', text: reasoning } }
    }
    for (const [index, call] of toolState) yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id as never, name: call.name, arguments: call.arguments } }
    yield { type: 'finish', reason: { kind: finishReason } } as StreamChunk
  }
}

function projectMessage(message: GenerateOptions['messages'][number]): Record<string, unknown> {
  const content = message.content.map(block => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text
    if (block.type === 'tool-call') return ''
    if (block.type === 'file') return `[file: ${block.attachment.name}]`
    if (block.type === 'image') return block.offloaded ? '[image omitted]' : '[image]'
    return ''
  }).join('')
  const role = message.role === 'developer' ? 'developer' : message.role
  const result: Record<string, unknown> = { role, content }
  if (message.role === 'assistant') {
    const calls = message.content.filter(block => block.type === 'tool-call')
    if (calls.length) result.tool_calls = calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }))
  }
  if (message.role === 'tool') result.tool_call_id = message.toolCallId
  return result
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.startsWith('data:')) yield line.slice(5).trim()
    }
    buffer += decoder.decode()
    if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
  } finally {
    reader.releaseLock()
  }
}
