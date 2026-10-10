package channels

import (
	"context"
	"encoding/json"
	"testing"
)

func TestQwenRegistry(t *testing.T) {
	ch, ok := Get("qwen")
	if !ok {
		t.Fatal("qwen channel not registered")
	}
	if ch.Name() != "qwen" {
		t.Fatalf("name = %s", ch.Name())
	}
}

func TestQwenFetchModels(t *testing.T) {
	fetchFn := func(url string) ([]byte, error) {
		if url != "http://localhost:8000/v1/models" {
			t.Fatalf("url = %s", url)
		}
		return []byte(`{"object":"list","data":[{"id":"qwen3.8-27b-instruct"},{"id":"qwen3.8-max"}]}`), nil
	}
	ch, ok := Get("qwen")
	if !ok {
		t.Fatal("qwen channel not found")
	}
	ms, err := ch.FetchModels(context.Background(), "k", fetchFn)
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 2 || ms[0].ID != "qwen3.8-27b-instruct" || ms[1].ID != "qwen3.8-max" {
		t.Fatalf("models = %+v", ms)
	}
}

func TestQwenRequestOverrides(t *testing.T) {
	ch, ok := Get("qwen")
	if !ok {
		t.Fatal("qwen channel not found")
	}
	ov, rm := ch.RequestOverrides("qwen3.8-27b-instruct")
	if ov != nil {
		t.Fatalf("overrides should be nil, got %v", ov)
	}
	if rm != nil {
		t.Fatalf("removeKeys should be nil, got %v", rm)
	}
}

func TestQwenCaps(t *testing.T) {
	ch, ok := Get("qwen")
	if !ok {
		t.Fatal("qwen channel not found")
	}
	cl, mo := ch.DefaultModelCaps()
	if cl != 131072 || mo != 8192 {
		t.Fatalf("caps = %d/%d", cl, mo)
	}
}

// TestQwenTransformRequestBody 验证兼容模式请求体。
func TestQwenTransformRequestBody(t *testing.T) {
	ch, ok := Get("qwen")
	if !ok {
		t.Fatal("qwen channel not found")
	}

	cases := []struct {
		name    string
		input   map[string]any
		enabled any
		budget  any
		changed bool
	}{
		{name: "enabled + budget", input: map[string]any{"model": "qwen-plus", "thinking": map[string]any{"type": "enabled"}, "reasoning_effort": "high", "thinking_budget": 2048}, enabled: true, budget: int64(2048), changed: true},
		{name: "disabled", input: map[string]any{"model": "qwen-plus", "thinking": map[string]any{"type": "disabled"}, "reasoning_effort": "off"}, enabled: false, changed: true},
		{name: "no thinking fields", input: map[string]any{"model": "qwen-plus", "messages": []any{}}, changed: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// 深拷贝 input,避免用例间互相影响
			raw, _ := json.Marshal(tc.input)
			var body map[string]any
			json.Unmarshal(raw, &body)

			got := ch.TransformRequestBody(body)
			if got != tc.changed {
				t.Fatalf("changed = %v, want %v", got, tc.changed)
			}

			if _, ok := body["thinking"]; ok {
				t.Fatalf("thinking leaked: %#v", body)
			}
			if _, ok := body["reasoning_effort"]; ok {
				t.Fatalf("reasoning_effort leaked: %#v", body)
			}
			if tc.enabled != nil && body["enable_thinking"] != tc.enabled {
				t.Fatalf("enable_thinking = %v, want %v", body["enable_thinking"], tc.enabled)
			}
			if tc.budget != nil && body["thinking_budget"] != tc.budget {
				t.Fatalf("thinking_budget = %v, want %v", body["thinking_budget"], tc.budget)
			}

			// 验证其他字段保留
			if body["model"] != "qwen-plus" {
				t.Fatalf("model field was modified: %v", body["model"])
			}
		})
	}
}
