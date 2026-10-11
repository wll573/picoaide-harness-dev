package llmgateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/picoaide/picoaide/internal/serverstore"
)

func TestTranscriptMiddlewareAuditsNonStreamingRoute(t *testing.T) {
	t.Setenv("PICOAI_MASTER_KEY", "0123456789abcdef")
	upstream := newAuditR3Upstream(t)
	router, db, userID, token := newAuditR3Gateway(t, upstream, 100, 1, 1, 0)
	requestBody := `{"model":"r3-model","messages":[{"role":"user","content":"audit me"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(requestBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.Code, resp.Body.String())
	}
	if requestID := resp.Header().Get("X-Request-ID"); len(requestID) != 32 {
		t.Fatalf("X-Request-ID = %q, want 32 hex characters", requestID)
	}

	page, err := serverstore.ListLLMTranscripts(db, userID, 0, 10, "r3-model")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("transcripts = %+v", page)
	}
	// 列表只返回元数据；正文要走详情接口（GetLLMTranscript）。
	row, err := serverstore.GetLLMTranscript(db, page.Items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.RequestBody != string(serverstore.SanitizeLLMTranscriptRequest([]byte(requestBody))) || row.AuditStatus != "complete" {
		t.Fatalf("transcript metadata = %+v", row)
	}
	if row.Provider != "r3p" || row.InputTokens != 1000000 || row.OutputTokens <= 0 || row.TotalTokens != row.InputTokens+row.OutputTokens {
		t.Fatalf("transcript usage metadata = provider=%q input=%d output=%d total=%d", row.Provider, row.InputTokens, row.OutputTokens, row.TotalTokens)
	}
	response, err := serverstore.ReadLLMTranscriptResponse(db, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(response) != resp.Body.String() {
		t.Fatalf("stored response differs from client response: stored=%q client=%q", response, resp.Body.String())
	}
}

func TestTranscriptMiddlewareAuditsStreamingRouteInOrder(t *testing.T) {
	t.Setenv("PICOAI_MASTER_KEY", "0123456789abcdef")
	upstream := newAuditR3Upstream(t)
	// 必须带 [DONE]：没有收尾标记会被网关判为截断并追加错误事件（R15C）。
	upstream.setStream("data: first\n\ndata: second\n\ndata: [DONE]\n\n")
	router, db, userID, token := newAuditR3Gateway(t, upstream, 100, 1, 1, 0)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"r3-model","stream":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK || resp.Body.String() != "data: first\n\ndata: second\n\ndata: [DONE]\n\n" {
		t.Fatalf("stream response = status %d body %q", resp.Code, resp.Body.String())
	}

	page, err := serverstore.ListLLMTranscripts(db, userID, 0, 10, "r3-model")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("transcripts = %+v", page)
	}
	response, err := serverstore.ReadLLMTranscriptResponse(db, page.Items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(response) != resp.Body.String() {
		t.Fatalf("stored stream response = %q, client = %q", response, resp.Body.String())
	}
}
