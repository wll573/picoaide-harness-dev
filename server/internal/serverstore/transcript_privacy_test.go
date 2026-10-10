package serverstore

import (
	"strings"
	"testing"
)

func TestMigrateLLMTranscriptPrivacyUpgradesLegacyPlaintext(t *testing.T) {
	t.Setenv("PICOAI_MASTER_KEY", "0123456789abcdef")
	db, cleanup := NewTestDB(t)
	t.Cleanup(cleanup)
	userID, err := CreateUser(db, &User{Username: "legacy-privacy-user", Source: "local", Status: 1})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := CreateLLMTranscript(db, userID, "/v1/chat/completions", "m", []byte(`{"model":"m"}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE llm_transcripts SET request_body_enc=? WHERE id=?`, `{"messages":[{"role":"system","content":"private"},{"role":"user","content":"hello"}],"tools":[{"name":"secret"}]}`, id); err != nil {
		t.Fatal(err)
	}
	if err := AppendLLMTranscriptChunk(db, id, 0, []byte("placeholder")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE llm_transcript_chunks SET payload_enc=? WHERE transcript_id=?`, `data: {"choices":[{"delta":{"reasoning_content":"private","content":"answer"}}]}`, id); err != nil {
		t.Fatal(err)
	}
	changed, err := MigrateLLMTranscriptPrivacy(db)
	if err != nil || changed != 1 {
		t.Fatalf("migration changed=%d err=%v", changed, err)
	}
	row, err := GetLLMTranscript(db, id)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(row.RequestBody, "private") || !strings.Contains(row.RequestBody, "hello") {
		t.Fatalf("request after migration = %s", row.RequestBody)
	}
	response, err := ReadLLMTranscriptResponse(db, id)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(response), "reasoning_content") || strings.Contains(string(response), "private") || !strings.Contains(string(response), "answer") {
		t.Fatalf("response after migration = %s", response)
	}
	var stored string
	if err := db.QueryRow(`SELECT request_body_enc FROM llm_transcripts WHERE id=?`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "enc:v1:") {
		t.Fatalf("request remains plaintext: %s", stored)
	}
}

func TestSanitizeLLMTranscriptRequestRemovesSystemAndTools(t *testing.T) {
	raw := []byte(`{"model":"m","instructions":"secret instruction","messages":[{"role":"system","content":"private prompt"},{"role":"user","content":"hello"}],"tools":[{"type":"function","function":{"name":"pwsh","description":"private tool"}}]}`)
	got := string(SanitizeLLMTranscriptRequest(raw))
	if strings.Contains(got, "private prompt") || strings.Contains(got, "private tool") || strings.Contains(got, "secret instruction") {
		t.Fatalf("sanitized request still contains private context: %s", got)
	}
	if !strings.Contains(got, "hello") || !strings.Contains(got, transcriptRedactedSystem) {
		t.Fatalf("sanitized request lost audit context: %s", got)
	}
}

func TestSanitizeLLMTranscriptResponseRemovesReasoningFromJSONAndSSE(t *testing.T) {
	jsonBody := []byte(`{"choices":[{"delta":{"reasoning_content":"secret","content":"visible"}}]}`)
	if got := string(SanitizeLLMTranscriptResponse(jsonBody)); strings.Contains(got, "reasoning_content") || strings.Contains(got, "secret") || !strings.Contains(got, "visible") {
		t.Fatalf("sanitized JSON response = %s", got)
	}
	sse := []byte("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"secret\",\"content\":\"visible\"}}]}\n\ndata: [DONE]\n\n")
	got := string(SanitizeLLMTranscriptResponse(sse))
	if strings.Contains(got, "reasoning_content") || strings.Contains(got, "secret") || !strings.Contains(got, "visible") || !strings.Contains(got, "[DONE]") {
		t.Fatalf("sanitized SSE response = %s", got)
	}
}

func TestSanitizeLLMTranscriptRequestInvalidJSONDoesNotRetainBody(t *testing.T) {
	got := string(SanitizeLLMTranscriptRequest([]byte(`not-json private prompt`)))
	if strings.Contains(got, "private prompt") || !strings.Contains(got, "invalid_json") {
		t.Fatalf("invalid request was not redacted: %s", got)
	}
}

func TestTranscriptPrivacyPreservesHumanAndToolActivity(t *testing.T) {
	raw := []byte(`{"messages":[{"role":"user","content":"介绍下你自己"},{"role":"user","content":"Current runtime context. This snapshot supersedes earlier runtime-context snapshots. private runtime"},{"role":"assistant","reasoning_content":"private thought","tool_calls":[{"function":{"name":"pwsh","arguments":"dir"}}],"function_call":{"name":"read","arguments":"{}"}}]}`)
	got := string(SanitizeLLMTranscriptRequest(raw))
	for _, secret := range []string{"private runtime", "private thought", "reasoning_content"} {
		if strings.Contains(got, secret) {
			t.Fatalf("request leaked %s: %s", secret, got)
		}
	}
	for _, keep := range []string{"介绍下你自己", "pwsh", "dir", "function_call"} {
		if !strings.Contains(got, keep) {
			t.Fatalf("request lost %s: %s", keep, got)
		}
	}
	response := []byte(`{"output":[{"type":"reasoning","summary":[{"text":"private summary"}]},{"type":"message","content":[{"type":"output_text","text":"visible"}]}],"usage":{"output_tokens_details":{"reasoning_tokens":10}}}`)
	got = string(SanitizeLLMTranscriptResponse(response))
	if strings.Contains(got, "private summary") || !strings.Contains(got, "visible") || !strings.Contains(got, "reasoning_tokens") {
		t.Fatalf("Responses privacy = %s", got)
	}
}
