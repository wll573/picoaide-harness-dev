package serverstore

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/picoaide/picoaide/internal/util"
)

const transcriptRedactedSystem = "[REDACTED SYSTEM INSTRUCTIONS]"

// SanitizeLLMTranscriptRequest removes model-only context before a request is
// retained by the audit store. System/developer instructions and tool schemas
// are implementation details, not user activity, and can contain local paths,
// secrets, or the complete host capability catalog.
func SanitizeLLMTranscriptRequest(body []byte) []byte {
	var value any
	if json.Unmarshal(body, &value) != nil {
		return []byte(`{"_redacted":"invalid_json"}`)
	}
	original, _ := json.Marshal(value)
	value = sanitizeTranscriptRequestValue(value, "")
	out, err := json.Marshal(value)
	if err != nil {
		return []byte(`{"_redacted":"serialization_error"}`)
	}
	if bytes.Equal(original, out) {
		return append([]byte(nil), body...)
	}
	return out
}

func sanitizeTranscriptRequestValue(value any, key string) any {
	switch v := value.(type) {
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			if message, ok := item.(map[string]any); ok {
				content, _ := message["content"].(string)
				if message["role"] == "user" && strings.HasPrefix(strings.TrimSpace(content), "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.") {
					continue
				}
			}
			out = append(out, sanitizeTranscriptRequestValue(item, key))
		}
		return out
	case map[string]any:
		if role, ok := v["role"].(string); ok {
			switch strings.ToLower(strings.TrimSpace(role)) {
			case "system", "developer":
				return map[string]any{"role": role, "content": transcriptRedactedSystem}
			}
		}
		out := make(map[string]any, len(v))
		for k, item := range v {
			switch strings.ToLower(k) {
			case "tools", "functions", "tool_choice":
				if key != "" {
					out[k] = sanitizeTranscriptRequestValue(item, k)
					continue
				}
				// Tool definitions are host internals and are never needed to
				// establish what the user asked or what the model returned.
				continue
			case "instructions", "system_prompt", "developer_prompt", "system":
				out[k] = transcriptRedactedSystem
				continue
			}
			out[k] = sanitizeTranscriptRequestValue(item, k)
		}
		return redactTranscriptReasoning(out)
	default:
		return value
	}
}

// SanitizeLLMTranscriptResponse removes model reasoning fields from a stored
// response while keeping the user-visible answer, tool calls, and protocol
// framing available for audit and replay.
func SanitizeLLMTranscriptResponse(body []byte) []byte {
	if len(body) == 0 {
		return nil
	}
	trimmed := bytes.TrimLeft(body, " \t\r\n")
	if bytes.HasPrefix(trimmed, []byte("data:")) || bytes.Contains(body, []byte("\ndata:")) {
		return sanitizeTranscriptSSE(body)
	}
	var value any
	if json.Unmarshal(body, &value) != nil {
		if bytes.Contains(body, []byte("reasoning_content")) || bytes.Contains(body, []byte("reasoningContent")) {
			return []byte(`{"_redacted":"unparseable_reasoning"}`)
		}
		return append([]byte(nil), body...)
	}
	original, _ := json.Marshal(value)
	value = redactTranscriptReasoning(value)
	out, err := json.Marshal(value)
	if err != nil {
		return append([]byte(nil), body...)
	}
	if bytes.Equal(original, out) {
		return append([]byte(nil), body...)
	}
	return out
}

func sanitizeTranscriptSSE(body []byte) []byte {
	var out bytes.Buffer
	for len(body) > 0 {
		idx := bytes.IndexByte(body, '\n')
		if idx < 0 {
			out.Write(sanitizeTranscriptSSELine(body))
			break
		}
		line := body[:idx+1]
		out.Write(sanitizeTranscriptSSELine(line))
		body = body[idx+1:]
	}
	return out.Bytes()
}

func sanitizeTranscriptSSELine(line []byte) []byte {
	trimmed := bytes.TrimLeft(line, " \t")
	if !bytes.HasPrefix(trimmed, []byte("data:")) {
		return append([]byte(nil), line...)
	}
	prefixLen := len(line) - len(trimmed)
	prefix := line[:prefixLen]
	data := trimmed[len("data:"):]
	ending := []byte{}
	if bytes.HasSuffix(data, []byte("\r\n")) {
		data, ending = data[:len(data)-2], []byte("\r\n")
	} else if bytes.HasSuffix(data, []byte("\n")) {
		data, ending = data[:len(data)-1], []byte("\n")
	}
	trimmedData := bytes.TrimSpace(data)
	if len(trimmedData) == 0 || bytes.Equal(trimmedData, []byte("[DONE]")) {
		return append([]byte(nil), line...)
	}
	var value any
	if json.Unmarshal(trimmedData, &value) != nil {
		if bytes.Contains(trimmedData, []byte("reasoning_content")) {
			return []byte("data: {\"_redacted\":\"unparseable_reasoning\"}\n")
		}
		return append([]byte(nil), line...)
	}
	original, _ := json.Marshal(value)
	encoded, err := json.Marshal(redactTranscriptReasoning(value))
	if err != nil {
		return append([]byte(nil), line...)
	}
	if bytes.Equal(original, encoded) {
		return append([]byte(nil), line...)
	}
	result := append([]byte{}, prefix...)
	result = append(result, []byte("data: ")...)
	result = append(result, encoded...)
	result = append(result, ending...)
	return result
}

func redactTranscriptReasoning(value any) any {
	switch v := value.(type) {
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, redactTranscriptReasoning(item))
		}
		return out
	case map[string]any:
		if kind, _ := v["type"].(string); kind == "reasoning" || kind == "thinking" || kind == "redacted_thinking" || strings.HasPrefix(kind, "response.reasoning") || strings.HasPrefix(kind, "response.encrypted_reasoning") || kind == "thinking_delta" || kind == "signature_delta" {
			return map[string]any{"type": "redacted_reasoning"}
		}
		out := make(map[string]any, len(v))
		for k, item := range v {
			if strings.EqualFold(k, "reasoning_content") || strings.EqualFold(k, "reasoningContent") || k == "thinking" || k == "encrypted_content" {
				continue
			}
			out[k] = redactTranscriptReasoning(item)
		}
		return out
	default:
		return value
	}
}

func encryptTranscriptPayload(body []byte) (string, error) {
	key, err := util.GetMasterKey()
	if err != nil {
		return "", err
	}
	return util.Encrypt(key, string(body)), nil
}

func decryptTranscriptPayload(raw string) ([]byte, error) {
	if raw == "" {
		return nil, nil
	}
	if !strings.HasPrefix(raw, util.EncPrefix) {
		// Rows written before transcript encryption was wired are retained for
		// one read so the startup backfill can upgrade them safely.
		return []byte(raw), nil
	}
	key, err := util.GetMasterKey()
	if err != nil {
		return nil, err
	}
	plain, err := util.Decrypt(key, raw)
	if err != nil {
		return nil, err
	}
	return []byte(plain), nil
}

func transcriptPayloadIsEncrypted(raw string) bool {
	return strings.HasPrefix(raw, util.EncPrefix)
}
