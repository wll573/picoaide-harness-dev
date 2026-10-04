package serverauth

import "testing"

func TestReadableRequest(t *testing.T) {
	got := readableRequest(`{"model":"m","messages":[{"role":"system","content":"s"},{"role":"user","content":"你好"},{"role":"user","content":[{"type":"text","text":"再问"}]}]}`)
	if got != "你好\n---\n再问" {
		t.Fatalf("got %q", got)
	}
	if got := readableRequest("not json"); got != "not json" {
		t.Fatalf("非 JSON 必须原样返回, got %q", got)
	}
}

func TestReadableResponse(t *testing.T) {
	cases := map[string]string{
		`{"choices":[{"message":{"content":"你好呀"}}]}`: "你好呀",
		"data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\ndata: [DONE]\n": "你好",
		`{"content":[{"type":"text","text":"anthropic"}]}`: "anthropic",
	}
	for in, want := range cases {
		if got := readableResponse(in); got != want {
			t.Errorf("readableResponse(%q) = %q, want %q", in, got, want)
		}
	}
	raw := "event: weird\nfoo"
	if got := readableResponse(raw); got != raw {
		t.Errorf("认不出的形状必须原样返回, got %q", got)
	}
}

// TestReadableResponseStreamShapes 守住三条流各自的**增量字段名**。
//
// 为什么单列一条用例：这三种流的 `delta` **同名不同形状**（chat 的
// `choices[].delta.content`、Anthropic 的 `delta.text`、Responses 的裸字符串
// `delta`）。曾出现过的缺陷形态是把三者塞进同一个 struct —— Go 的
// `encoding/json` 对同名重复字段会互相把值冲成零，后果不是"Responses 拿不到"
// 而是**三路同时失效**（连本来正确的 Anthropic 路径一起坏掉），且坏法是把
// 整份 SSE 原文当回复写进审计 —— 静默、且只在真跑某一家上游时暴露。
func TestReadableResponseStreamShapes(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{
			"chat 流",
			"data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n",
			"你好",
		},
		{
			"anthropic 流",
			"event: content_block_delta\n" +
				"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"世界\"}}\n\n",
			"世界",
		},
		{
			"responses 流（裸字符串 delta）",
			"event: response.output_text.delta\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"答\"}\n\n" +
				"data: {\"type\":\"response.completed\"}\n\n",
			"答",
		},
		{
			"responses 流：多段拼接",
			"data: {\"type\":\"response.output_text.delta\",\"delta\":\"今\"}\n\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"天\"}\n\n",
			"今天",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := readableResponse(c.in); got != c.want {
				t.Fatalf("readableResponse = %q, want %q（整份 SSE 原文被当成回复即为本用例要拦的缺陷）", got, c.want)
			}
		})
	}
}
