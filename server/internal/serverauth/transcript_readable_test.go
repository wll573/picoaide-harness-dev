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
