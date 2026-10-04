package llmgateway

// 需求 §12「代理缓冲导致前端长时间无响应」的判据：**SSE 连接沉默时必须主动发心跳**。
//
// 缺陷形态（补心跳之前）：整条链路只在"收到上游行"时才写字节。长思考模型在
// reasoning 阶段可以几分钟不吐 token，那段时间连接上**一个字节都不流动** ——
//   ① nginx 等反代的 proxy_read_timeout（缺省 60s）掐断空闲连接；
//   ② 服务端自己的 WriteTimeout（5min，main.go）掐断；
//   ③ 客户端分不出"模型在思考"还是"连接死了"，界面一直转圈。
// 三条都不报错，只是表现为"大模型偶尔答不出来"。
//
// 判据设计：把 streamKeepAliveEvery 调成远小于上游沉默时长，断言客户端收到的
// body 里出现 SSE 注释行（`: `）。用注释行而不是 data 事件是有意的 —— SSE 规范
// 要求客户端忽略注释，所以它**不改变事件语义**，只是让字节重新流动。

import (
	"strings"
	"testing"
	"time"
)

// TestStreamKeepAliveFillsSilentGap 是核心判据：上游思考期间客户端必须收到心跳，
// 且**不影响**最终送达的正文与收尾标记。
func TestStreamKeepAliveFillsSilentGap(t *testing.T) {
	defer func(prev time.Duration) { streamKeepAliveEvery = prev }(streamKeepAliveEvery)
	streamKeepAliveEvery = 30 * time.Millisecond

	f := newFakeUpstream(t)
	// 上游先沉默 150ms（≈5 个心跳周期）再吐正文 —— 模拟长思考模型的 reasoning 阶段。
	f.firstDelay = 150 * time.Millisecond
	r, _, token := newGateway(t, f)

	w := doPost(t, r, "/v1/chat/completions",
		`{"model":"deepseek-chat","stream":true,"messages":[{"role":"user","content":"hi"}]}`, token, nil)
	body := w.Body.String()

	if !strings.Contains(body, ": ") {
		t.Fatalf("上游沉默期间必须发 SSE 心跳（注释行）—— 拆掉心跳即红。body=%q", body)
	}
	// 反向面：心跳不得取代或破坏真实内容。
	if !strings.Contains(body, `"hi"`) {
		t.Fatalf("心跳不得挤掉正文, body=%q", body)
	}
	if !strings.Contains(body, "[DONE]") {
		t.Fatalf("心跳不得影响收尾标记, body=%q", body)
	}
}

// TestStreamKeepAliveDoesNotPolluteDeliveredContent 守住**心跳不进审计**这条：
// 心跳是注释行，`contentTracker` 必须忽略它（既不算已交付内容字节，也不触发
// "内容已交付"的判定）—— 否则心跳会把一个"上游还没吐字"的流误判成已交付，
// 进而改变结算语义。
func TestStreamKeepAliveDoesNotPolluteDeliveredContent(t *testing.T) {
	var tracker streamContentTracker
	if n, delivered := tracker.observe(": keep-alive"); n != 0 || delivered {
		t.Fatalf("心跳注释行不得被当成已交付内容: n=%d delivered=%v", n, delivered)
	}
	if n, delivered := tracker.observe(""); n != 0 || delivered {
		t.Fatalf("空行（事件边界）不得被当成已交付内容: n=%d delivered=%v", n, delivered)
	}
}
