package llmgateway

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// TestServeStreamIdleTimeoutClosesWithoutHang 是 Batch 1B 的核心自动化：
// 上游吐出首包后永久沉默时，serveStream 必须在 streamIdleTimeout 内结束，
// 并向客户端写出可读的 UPSTREAM 空闲超时错误 —— 禁止无限挂起。
//
// 不依赖 Postgres（直接泵 serveStream，usageID=0），保证无 DB 环境也能红/绿。
func TestServeStreamIdleTimeoutClosesWithoutHang(t *testing.T) {
	gin.SetMode(gin.TestMode)

	defer func(prev time.Duration) { streamIdleTimeout = prev }(streamIdleTimeout)
	streamIdleTimeout = 250 * time.Millisecond
	defer func(prev time.Duration) { streamKeepAliveEvery = prev }(streamKeepAliveEvery)
	streamKeepAliveEvery = 50 * time.Millisecond

	pr, pw := io.Pipe()
	release := make(chan struct{})
	go func() {
		fmt.Fprint(pw, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n")
		<-release
		_ = pw.Close()
	}()
	t.Cleanup(func() { close(release) })

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       pr,
		Header:     make(http.Header),
	}

	start := time.Now()
	(&API{}).serveStream(c, resp, 0, nil, nil, 0)
	elapsed := time.Since(start)
	if elapsed > 3*time.Second {
		t.Fatalf("stream hung %v — idle timeout failed to close", elapsed)
	}
	if elapsed < streamIdleTimeout {
		t.Fatalf("returned too fast (%v) before idle window %v", elapsed, streamIdleTimeout)
	}

	body := w.Body.String()
	if !strings.Contains(body, `"content":"hi"`) {
		t.Fatalf("first chunk missing: %q", body)
	}
	if !strings.Contains(body, `"code":"UPSTREAM"`) || !strings.Contains(body, "空闲超时") {
		t.Fatalf("readable idle timeout error missing: %q", body)
	}
	if strings.Contains(body, "[DONE]") {
		t.Fatalf("must terminate before [DONE]: %q", body)
	}
}

// TestServeStreamKeepAliveDuringSilence 断言沉默期会写出 SSE 注释心跳，
// 且正文/[DONE] 仍正常到达（默认 keepalive=15s；测试压到毫秒级）。
func TestServeStreamKeepAliveDuringSilence(t *testing.T) {
	gin.SetMode(gin.TestMode)

	defer func(prev time.Duration) { streamKeepAliveEvery = prev }(streamKeepAliveEvery)
	streamKeepAliveEvery = 40 * time.Millisecond
	defer func(prev time.Duration) { streamIdleTimeout = prev }(streamIdleTimeout)
	streamIdleTimeout = 2 * time.Second // 本用例测心跳，不测空闲掐断

	pr, pw := io.Pipe()
	go func() {
		time.Sleep(180 * time.Millisecond) // ≥ 数个心跳周期
		fmt.Fprint(pw, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n")
		fmt.Fprint(pw, "data: [DONE]\n\n")
		_ = pw.Close()
	}()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       pr,
		Header:     make(http.Header),
	}

	(&API{}).serveStream(c, resp, 0, nil, nil, 0)
	body := w.Body.String()
	if !strings.Contains(body, ": ") {
		t.Fatalf("silence must emit SSE keep-alive comment; body=%q", body)
	}
	if !strings.Contains(body, `"hi"`) {
		t.Fatalf("keepalive must not drop content; body=%q", body)
	}
	if !strings.Contains(body, "[DONE]") {
		t.Fatalf("keepalive must not drop terminal; body=%q", body)
	}
}
