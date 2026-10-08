package serverauth

import (
	"database/sql"
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/picoaide/picoaide/internal/serverstore"
)

// exportTranscriptMaxRows 是单次导出的行数上限。
//
// 导出是"按筛选条件批量导出"（需求 §8.2），但审计表可能很大；无上限的导出既能把
// 服务端内存打满、也能让一次误点变成全库明文外泄。上限之外让管理员收窄筛选再导。
const exportTranscriptMaxRows = 2000

// parseTranscriptFilter 把查询参数解析成筛选条件，列表与导出**共用同一份**解析 ——
// 两处各写一遍迟早漂移，"列表看到 N 条、导出却是另一批"正是最难排查的那类缺陷。
//
// 日期参数接受 `YYYY-MM-DD`（按本地时区整天）或 RFC3339；`until` 的纯日期口径取
// **当天结束**，否则管理员选"到 10-02"会漏掉 10-02 当天的全部记录。
func parseTranscriptFilter(c *gin.Context) (serverstore.LLMTranscriptFilter, error) {
	userID, _ := strconv.ParseInt(c.Query("user_id"), 10, 64)
	filter := serverstore.LLMTranscriptFilter{
		UserID:      userID,
		Model:       c.Query("model"),
		Endpoint:    c.Query("endpoint"),
		SessionID:   strings.TrimSpace(c.Query("session_id")),
		AuditStatus: strings.TrimSpace(c.Query("audit_status")),
		Keyword:     strings.TrimSpace(c.Query("keyword")),
	}
	if raw := strings.TrimSpace(c.Query("since")); raw != "" {
		t, err := parseTranscriptTime(raw, false)
		if err != nil {
			return filter, errors.New("since 不是有效日期(YYYY-MM-DD 或 RFC3339)")
		}
		filter.Since = &t
	}
	if raw := strings.TrimSpace(c.Query("until")); raw != "" {
		t, err := parseTranscriptTime(raw, true)
		if err != nil {
			return filter, errors.New("until 不是有效日期(YYYY-MM-DD 或 RFC3339)")
		}
		filter.Until = &t
	}
	return filter, nil
}

func parseTranscriptTime(raw string, endOfDay bool) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t, nil
	}
	t, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return time.Time{}, err
	}
	if endOfDay {
		return t.Add(24*time.Hour - time.Nanosecond), nil
	}
	return t, nil
}

// transcriptRow 是列表/导出共用的一行：元数据 + 用户名。
type transcriptRow struct {
	serverstore.LLMTranscript
	Username string `json:"username"`
	// UserDeleted：用户已被抹除（审计记录按设计保留）。前端据此显示"已删除用户"，
	// 而不是退回去显示裸 user_id。
	UserDeleted bool `json:"user_deleted"`
}

func (a *AdminAPI) withUsernames(items []serverstore.LLMTranscript) []transcriptRow {
	ids := make([]int64, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.UserID)
	}
	names, err := serverstore.UsernamesByIDs(a.DB, ids)
	rows := make([]transcriptRow, 0, len(items))
	for _, it := range items {
		name, ok := names[it.UserID]
		rows = append(rows, transcriptRow{
			LLMTranscript: it,
			Username:      name,
			// 查询失败时不能把所有人都标成"已删除"：那是把"没查到"说成"被删了"。
			UserDeleted: err == nil && !ok,
		})
	}
	return rows
}

func (a *AdminAPI) listLLMTranscripts(c *gin.Context) {
	offset, _ := strconv.ParseInt(c.DefaultQuery("offset", "0"), 10, 64)
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "50"), 10, 64)
	filter, err := parseTranscriptFilter(c)
	if err != nil {
		WriteError(c, http.StatusBadRequest, "VALIDATION", err.Error())
		return
	}
	page, err := serverstore.ListLLMTranscriptsFiltered(a.DB, filter, offset, limit)
	if err != nil {
		WriteError(c, http.StatusInternalServerError, "INTERNAL", "查询审计记录失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"transcripts": a.withUsernames(page.Items), "total": page.Total})
}

func (a *AdminAPI) getLLMTranscript(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		WriteError(c, http.StatusBadRequest, "VALIDATION", "无效审计记录 ID")
		return
	}
	transcript, err := serverstore.GetLLMTranscript(a.DB, id)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(c, http.StatusNotFound, "NOT_FOUND", "审计记录不存在")
		return
	}
	if err != nil {
		WriteError(c, http.StatusInternalServerError, "INTERNAL", "读取审计记录失败")
		return
	}
	// 审计正文在库中 AES-GCM 加密，详情接口解密后只返回已经过隐私过滤的副本。
	response, err := serverstore.ReadLLMTranscriptResponse(a.DB, id)
	if err != nil {
		WriteError(c, http.StatusInternalServerError, "INTERNAL", "读取审计响应失败")
		return
	}
	rows := a.withUsernames([]serverstore.LLMTranscript{transcript})
	c.JSON(http.StatusOK, gin.H{
		"transcript": rows[0],
		"request":    transcript.RequestBody,
		"response":   string(response),
		// 管理端直接展示的可读文本：用户发了什么 / 模型回了什么（认不出形状时即原文）。
		"request_text":     readableRequest(transcript.RequestBody),
		"response_text":    readableResponse(string(response)),
		"decryptable":      true, // 兼容旧前端字段；服务端已完成解密并通过隐私过滤
		"decrypt_reason":   "",
		"response_present": len(response) > 0,
	})
}

// exportLLMTranscripts 按与列表相同的筛选条件导出审计记录为 CSV（需求 §8.2）。
//
// 只导出**元数据**（用户/会话/模型/供应商/耗时/Token/状态/错误），**不导出
// Prompt/Response 正文**：
//   - 正文是加密留存的敏感内容，批量导出等于把一整批明文搬出服务端边界；
//   - 管理员要看某条正文，走详情接口（逐条、可审计、需要解密成功）；
//   - 正文可能含换行/引号/超长文本，CSV 里既难读又容易撑爆表格软件。
//
// 行数上限见 exportTranscriptMaxRows；超限时在响应头 `X-Export-Truncated` 标明，
// 让前端提示"请收窄筛选"，而不是悄悄只给一部分。
func (a *AdminAPI) exportLLMTranscripts(c *gin.Context) {
	filter, err := parseTranscriptFilter(c)
	if err != nil {
		WriteError(c, http.StatusBadRequest, "VALIDATION", err.Error())
		return
	}
	page, err := serverstore.ListLLMTranscriptsFiltered(a.DB, filter, 0, exportTranscriptMaxRows)
	if err != nil {
		WriteError(c, http.StatusInternalServerError, "INTERNAL", "导出审计记录失败")
		return
	}
	rows := a.withUsernames(page.Items)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="llm-audit-`+time.Now().Format("20060102-150405")+`.csv"`)
	if page.Total > int64(len(rows)) {
		c.Header("X-Export-Truncated", "true")
	}
	c.Header("X-Export-Total", strconv.FormatInt(page.Total, 10))
	// UTF-8 BOM：Excel 打开无 BOM 的 UTF-8 CSV 会把中文显示成乱码。
	_, _ = c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"时间", "用户", "模型", "状态码", "输入Token", "输出Token", "用户请求", "模型回复"})
	for _, r := range rows {
		user := r.Username
		if r.UserDeleted {
			user = "(已删除用户)"
		}
		full, err := serverstore.GetLLMTranscript(a.DB, r.ID)
		if err != nil {
			continue
		}
		resp, _ := serverstore.ReadLLMTranscriptResponse(a.DB, r.ID)
		_ = w.Write([]string{
			r.CreatedAt.Format("2006-01-02 15:04:05"), csvSafe(user), csvSafe(r.Model),
			strconv.Itoa(r.StatusCode), strconv.FormatInt(r.InputTokens, 10), strconv.FormatInt(r.OutputTokens, 10),
			csvSafe(readableRequest(full.RequestBody)), csvSafe(readableResponse(string(resp))),
		})
	}
	w.Flush()
}

// csvSafe 防 CSV 公式注入：以 = + - @ 开头的单元格在 Excel 里会被当公式执行。
// 会话 id / 工作区 / 错误原因都来自客户端或上游，不可信，所以统一前置单引号中和。
func csvSafe(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}
