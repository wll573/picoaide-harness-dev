package llmgateway

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/picoaide/picoaide/internal/serverstore"
)

// Phase1 Batch 1D — 三联通总门禁（httptest mock；无真实内网 Key / 不提交密钥）。
//
// 拓扑：单一 http:// OpenAI 兼容 Base URL + ≥2 Key + ≥3 模型 ID（deepseek/qwen/glm）
// 必测：三模型流式收口、坏 Key 换 Key / 全 Key 429 不挂、慢上游 idle→UPSTREAM、
// 隐藏模型目录+路由双拒、全程 http://。

const (
	phase1dKeyBad  = "sk-phase1d-bad-key-xxxxxx"
	phase1dKeyGood = "sk-phase1d-good-key-xxxxx"
	phase1dKeyBad2 = "sk-phase1d-bad2-key-xxxxx"
)

var phase1dModelIDs = []string{"deepseek-chat", "qwen-plus", "glm-4"}

type triadMockUpstream struct {
	srv          *httptest.Server
	baseURL      string
	seenAuth     atomic.Value
	requests     atomic.Int64
	force429     atomic.Bool
	force401Keys map[string]struct{}
	stallAfter   atomic.Bool
}

func newTriadMock(t *testing.T) *triadMockUpstream {
	t.Helper()
	m := &triadMockUpstream{
		force401Keys: map[string]struct{}{
			phase1dKeyBad:  {},
			phase1dKeyBad2: {},
		},
	}
	m.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.requests.Add(1)
		auth := r.Header.Get("Authorization")
		m.seenAuth.Store(auth)
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Model  string `json:"model"`
			Stream bool   `json:"stream"`
		}
		_ = json.Unmarshal(body, &req)

		key := strings.TrimPrefix(auth, "Bearer ")
		if m.force429.Load() {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			fmt.Fprint(w, `{"error":{"message":"rate limited","type":"rate_limit_error"}}`)
			return
		}
		if _, bad := m.force401Keys[key]; bad {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"error":{"message":"Incorrect API key","type":"invalid_request_error"}}`)
			return
		}
		if !req.Stream {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"id":"mock","object":"chat.completion","model":%q,"choices":[{"message":{"role":"assistant","content":"ok-%s"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`, req.Model, req.Model)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hi-%s\"}}]}\n\n", req.Model)
		if flusher != nil {
			flusher.Flush()
		}
		if m.stallAfter.Load() {
			<-r.Context().Done()
			return
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	t.Cleanup(m.srv.Close)
	m.baseURL = m.srv.URL // always http://127.0.0.1:…
	return m
}

// setupPhase1D 建「同 provider + 多 Key + 三模型」网关；hiddenName 非空时额外加隐藏模型
// （同时写进 provider.models JSON，证明路由侧会 subtract）。
func setupPhase1D(t *testing.T, up *triadMockUpstream, keys []string, hiddenName string) (*gin.Engine, *sql.DB, string) {
	t.Helper()
	r, db, token := newGateway(t, nil)

	models := append([]string{}, phase1dModelIDs...)
	if hiddenName != "" {
		models = append(models, hiddenName)
	}
	pid, err := serverstore.AddGatewayProvider(db, &serverstore.GatewayProvider{
		Name:      "intranet-openai-compat",
		BaseURL:   up.baseURL,
		APIKeyEnc: keys[0],
		Models:    models,
		Enabled:   1,
		Protocol:  "openai",
		Channel:   "openai_compat",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range keys {
		if _, err := serverstore.AddGatewayProviderAPIKey(db, &serverstore.GatewayProviderAPIKey{
			ProviderID: pid, APIKeyEnc: k, Enabled: true, Priority: 0, Label: "pool",
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, mid := range phase1dModelIDs {
		if _, err := serverstore.AddModel(db, &serverstore.Model{
			Name: mid, ProviderID: pid, DisplayName: mid,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if hiddenName != "" {
		if _, err := serverstore.AddModel(db, &serverstore.Model{
			Name: hiddenName, ProviderID: pid, DisplayName: "Hidden Internal", Hidden: true,
		}); err != nil {
			t.Fatal(err)
		}
	}
	InvalidateUpstreams()
	return r, db, token
}

func chatBody(model string, stream bool) string {
	return fmt.Sprintf(`{"model":%q,"messages":[{"role":"user","content":"ping"}],"stream":%v}`, model, stream)
}

// 1) 同 provider：http Base URL + ≥2 Key + ≥3 模型 ID
func TestPhase1D_TopologyHTTPMultiKeyMultiModel(t *testing.T) {
	up := newTriadMock(t)
	_, db, _ := setupPhase1D(t, up, []string{phase1dKeyGood, phase1dKeyBad}, "")

	if !strings.HasPrefix(up.baseURL, "http://") || strings.HasPrefix(up.baseURL, "https://") {
		t.Fatalf("mock Base URL must be http://, got %q", up.baseURL)
	}
	if err := validateUpstreamBaseURL(up.baseURL); err != nil {
		t.Fatalf("http Base URL rejected by validateUpstreamBaseURL: %v", err)
	}
	if err := validateUpstreamBaseURL("http://llm-gw.intranet.example/v1"); err != nil {
		t.Fatalf("intranet-style http URL rejected: %v", err)
	}

	ups, err := LoadUpstreams(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 1 {
		t.Fatalf("want 1 provider, got %d", len(ups))
	}
	if !strings.HasPrefix(ups[0].BaseURL, "http://") {
		t.Fatalf("provider BaseURL not http: %q", ups[0].BaseURL)
	}
	if len(ups[0].Keys) < 2 {
		t.Fatalf("want ≥2 keys in pool, got %d (%#v)", len(ups[0].Keys), ups[0].Keys)
	}
	for _, mid := range phase1dModelIDs {
		hit := false
		for _, m := range ups[0].Models {
			if m == mid {
				hit = true
				break
			}
		}
		if !hit {
			t.Fatalf("model %q missing from route pool: %#v", mid, ups[0].Models)
		}
	}
}

// 2) 三个模型 ID 各跑一轮流式 chat，须正常结束（含 [DONE]）
func TestPhase1D_StreamingChatThreeModels(t *testing.T) {
	up := newTriadMock(t)
	r, _, token := setupPhase1D(t, up, []string{phase1dKeyGood, phase1dKeyBad}, "")

	for _, mid := range phase1dModelIDs {
		start := time.Now()
		w := doPost(t, r, "/v1/chat/completions", chatBody(mid, true), token, nil)
		elapsed := time.Since(start)
		if elapsed > 5*time.Second {
			t.Fatalf("model %s hung %v", mid, elapsed)
		}
		if w.Code != http.StatusOK {
			t.Fatalf("model %s status=%d body=%s", mid, w.Code, w.Body.String())
		}
		body := w.Body.String()
		if !strings.Contains(body, "hi-"+mid) {
			t.Fatalf("model %s missing stream content: %q", mid, body)
		}
		if !strings.Contains(body, "[DONE]") {
			t.Fatalf("model %s stream did not terminate cleanly: %q", mid, body)
		}
		if ct := w.Header().Get("Content-Type"); ct != "text/event-stream" {
			t.Fatalf("model %s Content-Type=%q", mid, ct)
		}
	}
}

// 3a) 坏 Key → 自动换好 Key 成功（不卡住）
func TestPhase1D_BadKeyFailoverToGoodKey(t *testing.T) {
	up := newTriadMock(t)
	// 池顺序：先坏后好；轮询可能先拿到任一把，但坏的会重试到好的
	r, _, token := setupPhase1D(t, up, []string{phase1dKeyBad, phase1dKeyGood}, "")

	start := time.Now()
	w := doPost(t, r, "/v1/chat/completions", chatBody("deepseek-chat", false), token, nil)
	elapsed := time.Since(start)
	if elapsed > 5*time.Second {
		t.Fatalf("hung %v on bad-key failover", elapsed)
	}
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s (want failover success)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "ok-deepseek-chat") {
		t.Fatalf("unexpected body: %s", w.Body.String())
	}
	if n := up.requests.Load(); n < 2 {
		t.Fatalf("upstream calls=%d, want ≥2 (bad then good)", n)
	}
	auth, _ := up.seenAuth.Load().(string)
	if auth != "Bearer "+phase1dKeyGood {
		t.Fatalf("final auth=%q, want good key", auth)
	}
}

// 3b) 全 Key 429：可读错误、不卡住
func TestPhase1D_AllKeys429ReadableNoHang(t *testing.T) {
	up := newTriadMock(t)
	up.force429.Store(true)
	r, _, token := setupPhase1D(t, up, []string{phase1dKeyBad, phase1dKeyBad2}, "")

	start := time.Now()
	w := doPost(t, r, "/v1/chat/completions", chatBody("qwen-plus", false), token, nil)
	elapsed := time.Since(start)
	if elapsed > 5*time.Second {
		t.Fatalf("hung %v on all-keys 429", elapsed)
	}
	// 全部 Key 耗尽 → 502 UPSTREAM「上游服务不可用」或透传末次 429；皆须可读且有终态
	body := w.Body.String()
	if w.Code == http.StatusOK {
		t.Fatalf("all-keys 429 must not succeed: %s", body)
	}
	if !(strings.Contains(body, "UPSTREAM") || strings.Contains(body, "429") || strings.Contains(body, "rate") || strings.Contains(body, "限流") || strings.Contains(body, "不可用")) {
		t.Fatalf("unreadable error on all-keys 429: status=%d body=%s", w.Code, body)
	}
}

// 4) 慢上游沉默：idle 收口 UPSTREAM 空闲超时
func TestPhase1D_SlowSilentUpstreamIdleTimeout(t *testing.T) {
	up := newTriadMock(t)
	up.stallAfter.Store(true)
	r, _, token := setupPhase1D(t, up, []string{phase1dKeyGood}, "")

	defer func(prev time.Duration) { streamIdleTimeout = prev }(streamIdleTimeout)
	streamIdleTimeout = 250 * time.Millisecond
	defer func(prev time.Duration) { streamKeepAliveEvery = prev }(streamKeepAliveEvery)
	streamKeepAliveEvery = 50 * time.Millisecond

	start := time.Now()
	w := doPost(t, r, "/v1/chat/completions", chatBody("glm-4", true), token, nil)
	elapsed := time.Since(start)
	if elapsed > 3*time.Second {
		t.Fatalf("stream hung %v — idle timeout failed", elapsed)
	}
	if elapsed < streamIdleTimeout {
		t.Fatalf("returned too fast (%v) before idle window", elapsed)
	}
	body := w.Body.String()
	if !strings.Contains(body, "hi-glm-4") {
		t.Fatalf("first chunk missing: %q", body)
	}
	if !strings.Contains(body, `"code":"UPSTREAM"`) || !strings.Contains(body, "空闲超时") {
		t.Fatalf("readable idle timeout missing: %q", body)
	}
	if strings.Contains(body, "[DONE]") {
		t.Fatalf("must terminate before [DONE]: %q", body)
	}
}

// 5) 隐藏模型：catalog 不可见；直打已知名拒绝
func TestPhase1D_HiddenModelCatalogAndRouteRejected(t *testing.T) {
	up := newTriadMock(t)
	const hidden = "secret-internal-model"
	r, db, token := setupPhase1D(t, up, []string{phase1dKeyGood}, hidden)

	ms, err := ListModels(db)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range ms {
		if m.ID == hidden {
			t.Fatalf("hidden model still in catalog: %#v", m)
		}
	}
	for _, mid := range phase1dModelIDs {
		found := false
		for _, m := range ms {
			if m.ID == mid {
				found = true
			}
		}
		if !found {
			t.Fatalf("visible model %q missing from catalog: %#v", mid, ms)
		}
	}

	ups, err := MatchModelsByProtocolFor(db, hidden, "openai", EndpointOpenAIChat)
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 0 {
		t.Fatalf("hidden model still routable: %#v", ups)
	}

	w := doPost(t, r, "/v1/chat/completions", chatBody(hidden, false), token, nil)
	if w.Code == http.StatusOK {
		t.Fatalf("direct known hidden name must be rejected, got 200: %s", w.Body.String())
	}
	if up.requests.Load() != 0 {
		t.Fatalf("upstream must not be called for hidden model, calls=%d", up.requests.Load())
	}
}

// 6) 协议：配置与校验面接受 http://，不强制 https
func TestPhase1D_AllHTTPNoForcedHTTPS(t *testing.T) {
	cases := []struct {
		url string
		ok  bool
	}{
		{"http://127.0.0.1:8081/v1", true},
		{"http://llm-gw.intranet.local", true},
		{"https://api.deepseek.com", true}, // 校验允许 https，但不强制；内网用 http
		{"ftp://x", false},
		{"", false},
	}
	for _, tc := range cases {
		err := validateUpstreamBaseURL(tc.url)
		if tc.ok && err != nil {
			t.Fatalf("%q should pass: %v", tc.url, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%q should fail", tc.url)
		}
	}
}
