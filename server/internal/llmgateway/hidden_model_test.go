package llmgateway

import (
	"testing"

	"github.com/picoaide/picoaide/internal/serverstore"
)

// TestHiddenModelExcludedFromCatalogAndRoute 证明隐藏不是"只对界面生效"：
// ① /v1/models（ListModels）看不到；② MatchModelsByProtocol 路由也命中不了
// （知道模型名直接 POST 也不能绕过）。对照需求 §7.1 / Phase1-Batch1C。
func TestHiddenModelExcludedFromCatalogAndRoute(t *testing.T) {
	db, cleanup := serverstore.NewTestDB(t)
	defer cleanup()

	orig := DecryptSecret
	DecryptSecret = func(s string) (string, error) { return s, nil }
	t.Cleanup(func() { DecryptSecret = orig })

	pid, err := serverstore.AddGatewayProvider(db, &serverstore.GatewayProvider{
		Name: "intranet-pool", BaseURL: "http://up.example", APIKeyEnc: "k1",
		Models: []string{"deepseek-chat", "qwen-plus"}, Enabled: 1, Protocol: "openai",
		Channel: "openai_compat",
	})
	if err != nil {
		t.Fatal(err)
	}
	visibleID, err := serverstore.AddModel(db, &serverstore.Model{
		Name: "deepseek-chat", ProviderID: pid, DisplayName: "DeepSeek Chat",
	})
	if err != nil {
		t.Fatal(err)
	}
	hiddenID, err := serverstore.AddModel(db, &serverstore.Model{
		Name: "qwen-plus", ProviderID: pid, DisplayName: "Qwen Plus", Hidden: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = visibleID
	_ = hiddenID

	InvalidateUpstreams()

	ms, err := ListModels(db)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range ms {
		if m.ID == "qwen-plus" {
			t.Fatalf("hidden model still in client catalog: %#v", m)
		}
	}
	foundVisible := false
	for _, m := range ms {
		if m.ID == "deepseek-chat" {
			foundVisible = true
		}
	}
	if !foundVisible {
		t.Fatalf("visible model missing from catalog: %#v", ms)
	}

	ups, err := MatchModelsByProtocol(db, "qwen-plus", "openai")
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 0 {
		t.Fatalf("hidden model still routable by known name: %#v", ups)
	}
	ups, err = MatchModelsByProtocol(db, "deepseek-chat", "openai")
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) == 0 {
		t.Fatal("visible model not routable")
	}
}
