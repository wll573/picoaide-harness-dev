package llmgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/picoaide/picoaide/internal/serverauth"
	"github.com/picoaide/picoaide/internal/serverstore"
)

const maxTranscriptResponseBytes = 128 << 20

type transcriptWriter struct {
	gin.ResponseWriter
	db           *sql.DB
	transcriptID int64
	seq          int64
	bytes        int64
	hash         hash.Hash
	err          error
	auditStream  bool
	auditPending []byte
}

func (w *transcriptWriter) Write(p []byte) (int, error) {
	if w.err != nil {
		return w.ResponseWriter.Write(p)
	}
	remaining := maxTranscriptResponseBytes - w.bytes
	if remaining <= 0 {
		w.err = serverstore.ErrLLMTranscriptResponseTooLarge
		return w.ResponseWriter.Write(p)
	}
	if int64(len(p)) > remaining {
		w.err = serverstore.ErrLLMTranscriptResponseTooLarge
		return w.ResponseWriter.Write(p)
	}
	n, err := w.ResponseWriter.Write(p)
	if err != nil {
		w.err = err
		return n, err
	}
	w.bytes += int64(n)
	_, _ = w.hash.Write(p[:n])
	w.auditPending = append(w.auditPending, p[:n]...)
	if w.auditStream {
		w.flushCompleteSSE(false)
	}
	return n, nil
}

// FlushAudit completes the bounded audit-side buffer after the handler has
// finished writing. It lets non-streaming JSON be parsed as a whole, so a
// reasoning_content field split across network writes cannot escape redaction.
func (w *transcriptWriter) FlushAudit() {
	if w.err != nil || len(w.auditPending) == 0 {
		return
	}
	if w.auditStream {
		w.flushCompleteSSE(true)
		return
	}
	w.appendAudit(serverstore.SanitizeLLMTranscriptResponse(w.auditPending))
	w.auditPending = nil
}

func (w *transcriptWriter) flushCompleteSSE(final bool) {
	for len(w.auditPending) > 0 {
		idx := bytes.Index(w.auditPending, []byte("\n\n"))
		delimLen := 2
		if idx < 0 {
			idx = bytes.Index(w.auditPending, []byte("\r\n\r\n"))
			delimLen = 4
		}
		if idx < 0 {
			break
		}
		end := idx + delimLen
		w.appendAudit(serverstore.SanitizeLLMTranscriptResponse(w.auditPending[:end]))
		w.auditPending = w.auditPending[end:]
		if w.err != nil {
			return
		}
	}
	if final && len(w.auditPending) > 0 && w.err == nil {
		w.appendAudit(serverstore.SanitizeLLMTranscriptResponse(w.auditPending))
		w.auditPending = nil
	}
}

func (w *transcriptWriter) appendAudit(payload []byte) {
	if w.err != nil || len(payload) == 0 {
		return
	}
	if err := serverstore.AppendLLMTranscriptChunk(w.db, w.transcriptID, w.seq, payload); err != nil {
		w.err = err
		return
	}
	w.seq++
}

func (w *transcriptWriter) WriteString(value string) (int, error) {
	return w.Write([]byte(value))
}

func (w *transcriptWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *transcriptWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func shouldTranscript(path string, method string) bool {
	if method != http.MethodPost {
		return false
	}
	return strings.HasSuffix(path, "/chat/completions") ||
		strings.HasSuffix(path, "/completions") ||
		strings.HasSuffix(path, "/responses") ||
		strings.HasSuffix(path, "/messages") ||
		strings.HasSuffix(path, "/embeddings")
}

// transcriptOutcomeCtxKey 是网关在流式收尾时写进 gin.Context 的**收尾结论**键。
//
// 为什么走 gin.Context 而不是解析响应字节反推截断：handler 与中间件**同包**
// （都在 llmgateway），`serveStream` 在退出前已经知道 `sawTerminal`（是否见过上游
// 收尾标记）与错误原因 —— 那是权威结论。从已写出的字节里再推一遍是脆弱做法：
// SSE 正文形状随协议/上游版本变化，反推规则迟早与真实判断分叉（这正是需求 §12
// 要修的"事件边界解析错误"同族问题）。
const transcriptOutcomeCtxKey = "llm_transcript_outcome"

// TranscriptOutcome 是网关交给审计中间件的收尾结论（0086）。
//
// 零值 = 正常完成（handler 没写就说明它没发现问题），所以 handler 只在**异常**时写。
type TranscriptOutcome struct {
	// Incomplete 表示上游未给收尾标记就结束了（截断/代理断开/in-band error）。
	Incomplete bool
	// ErrorType / ErrorMessage 是需求 §8.1「错误原因」的来源。
	ErrorType    string
	ErrorMessage string
	// Provider 是本次实际命中的上游供应商名（需求 §8.1「模型和供应商」）。
	Provider string
	// InputTokens / OutputTokens are the final metered values, including fallback estimates.
	InputTokens  int64
	OutputTokens int64
}

// setTranscriptOutcome 由 handler 调用，把收尾结论交给中间件。
func setTranscriptOutcome(c *gin.Context, outcome TranscriptOutcome) {
	if c == nil {
		return
	}
	c.Set(transcriptOutcomeCtxKey, outcome)
}

// mergeTranscriptOutcome 在原地合并字段：非零的写入值覆盖已有值，零值保持原样。
//
// 为什么需要它：一次请求里可能有多处要打标（命中供应商时写 Provider、截断时写
// Incomplete+ErrorType）。若每处都调 setTranscriptOutcome，后写的那处会把之前
// 写好的字段清零（结构体整体替换）。调用点分散在 serveStream 的多个分支里，
// 用"整体替换"迟早丢掉 Provider 这类早写的标签。
func mergeTranscriptOutcome(c *gin.Context, patch TranscriptOutcome) {
	if c == nil {
		return
	}
	current := transcriptOutcomeFrom(c)
	current.Incomplete = current.Incomplete || patch.Incomplete
	if patch.ErrorType != "" {
		current.ErrorType = patch.ErrorType
	}
	if patch.ErrorMessage != "" {
		current.ErrorMessage = patch.ErrorMessage
	}
	if patch.Provider != "" {
		current.Provider = patch.Provider
	}
	if patch.InputTokens > 0 {
		current.InputTokens = patch.InputTokens
	}
	if patch.OutputTokens > 0 {
		current.OutputTokens = patch.OutputTokens
	}
	c.Set(transcriptOutcomeCtxKey, current)
}

// transcriptOutcomeFrom 读回结论；没写过时返回零值（= 正常完成）。
func transcriptOutcomeFrom(c *gin.Context) TranscriptOutcome {
	if c == nil {
		return TranscriptOutcome{}
	}
	if value, ok := c.Get(transcriptOutcomeCtxKey); ok {
		if outcome, ok := value.(TranscriptOutcome); ok {
			return outcome
		}
	}
	return TranscriptOutcome{}
}

// sessionIDFromRequest 读客户端携带的会话 id（需求 §8.1「用户和会话」）。
//
// 复用应用归因那条链路用的同一个头（`x-deepseek-harness-session-id`）——它是客户端
// 出站请求上**已有**的会话标识，不新增协议。取值只作审计标签：与 usage.app_id 归因
// 同一条纪律（app_attribution.go 的长注释），它来自请求头、不是服务端可验证的事实，
// 因此只用于"按会话看历史"，不参与计费与授权。缺失即空串。
func sessionIDFromRequest(c *gin.Context) string {
	if c == nil {
		return ""
	}
	return strings.TrimSpace(c.GetHeader(appSessionIDHeaderName()))
}

// TranscriptMiddleware stores the authenticated client's request and a
// privacy-filtered response at the gateway boundary. System/developer prompt
// content, tool schemas, and model reasoning are removed before persistence;
// the response sent to the client is unchanged.
func TranscriptMiddleware(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil || !shouldTranscript(c.Request.URL.Path, c.Request.Method) {
			c.Next()
			return
		}
		user := serverauth.CurrentUser(c)
		if user == nil {
			c.Next()
			return
		}
		var requestBody []byte
		var err error
		if c.Request.Body != nil {
			requestBody, err = io.ReadAll(io.LimitReader(c.Request.Body, 64<<20+1))
		}
		if err != nil || len(requestBody) > 64<<20 {
			serverauth.WriteError(c, http.StatusRequestEntityTooLarge, "VALIDATION", "请求体过大")
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(requestBody))
		// 需求 §8.1「流式状态」：从请求体取，而不是从响应头推 —— 客户端请求
		// stream=true 而上游失败改成非流式（或反过来）时，审计要记的是**这次请求
		// 是不是流式语义**，响应形态另有 status_code/error 记录。
		stream := requestStreamed(requestBody)
		transcriptID, requestID, err := serverstore.CreateLLMTranscriptDetailed(db, serverstore.TranscriptCreate{
			UserID:    user.ID,
			Endpoint:  c.Request.URL.Path,
			Model:     serverstore.TranscriptModelFromRequest(requestBody),
			Stream:    stream,
			SessionID: sessionIDFromRequest(c),
			Body:      requestBody,
		})
		if err != nil {
			serverauth.WriteError(c, http.StatusServiceUnavailable, "AUDIT_UNAVAILABLE", "审计存储不可用,请求未执行")
			return
		}
		c.Header("X-Request-ID", requestID)
		writer := &transcriptWriter{ResponseWriter: c.Writer, db: db, transcriptID: transcriptID, hash: sha256.New(), auditStream: stream}
		c.Writer = writer
		started := time.Now()
		c.Next()
		writer.FlushAudit()
		// 需求 §8.1「请求时间和耗时」。
		durationMS := time.Since(started).Milliseconds()
		status := writer.Status()
		if status == 0 {
			status = http.StatusOK
		}
		outcome := transcriptOutcomeFrom(c)
		finish := serverstore.TranscriptFinish{
			StatusCode:    status,
			ResponseBytes: writer.bytes,
			ResponseSHA:   serverstore.TranscriptHashHex(writer.hash.Sum(nil)),
			AuditStatus:   "complete",
			DurationMS:    durationMS,
			InputTokens:   outcome.InputTokens,
			OutputTokens:  outcome.OutputTokens,
			Provider:      outcome.Provider,
			ErrorType:     outcome.ErrorType,
			ErrorMessage:  outcome.ErrorMessage,
		}
		// 判定优先级（需求 §8.3）：
		//   本地写失败/客户端中断  ⇒ write_failed（0083 既有语义，最具体）
		//   上游未给收尾标记      ⇒ incomplete（本次核心：断流不再与正常同形）
		//   否则                   ⇒ complete
		if writer.err != nil || errors.Is(c.Request.Context().Err(), context.Canceled) || errors.Is(c.Request.Context().Err(), context.DeadlineExceeded) {
			finish.AuditStatus = "write_failed"
		} else if outcome.Incomplete {
			finish.AuditStatus = "incomplete"
		}
		if err := serverstore.FinishLLMTranscriptDetailed(db, transcriptID, finish); err != nil {
			// The upstream response may already have been sent. Replacing it with
			// an error envelope would corrupt a successful JSON/SSE response, so
			// keep the response intact and surface the failure to operations.
			log.Printf("llm transcript %d finish failed: %v", transcriptID, err)
		}
	}
}

// requestStreamed 判断请求体是否声明了流式（`"stream": true`）。
//
// 只读这一个字段，不做完整 JSON 校验：请求体已经被上游校验过一次，这里判错不该
// 影响审计以外的任何东西。解析失败即 false（按非流式记，与"没声明"同义）。
func requestStreamed(body []byte) bool {
	var value struct {
		Stream bool `json:"stream"`
	}
	if json.Unmarshal(body, &value) != nil {
		return false
	}
	return value.Stream
}
