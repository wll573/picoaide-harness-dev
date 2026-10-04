package serverauth

import (
	"encoding/json"
	"strings"
)

// readableRequest 从请求体里取"用户发了什么"：所有 role=user 的消息文本（按顺序拼接）。
// 取不出来（形状不认识 / 非 JSON）时原样返回，保证导出永远不丢内容。
func readableRequest(raw string) string {
	var req struct {
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
		Input json.RawMessage `json:"input"`
	}
	if json.Unmarshal([]byte(raw), &req) != nil {
		return raw
	}
	var parts []string
	for _, m := range req.Messages {
		if m.Role != "user" {
			continue
		}
		if t := contentText(m.Content); t != "" {
			parts = append(parts, t)
		}
	}
	if len(parts) == 0 {
		if t := contentText(req.Input); t != "" {
			return t
		}
		return raw
	}
	return strings.Join(parts, "\n---\n")
}

// readableResponse 从回复里取"模型回了什么"。支持 OpenAI chat 的非流式与 SSE 流式、
// Anthropic messages 的非流式与 SSE。取不出来时原样返回。
func readableResponse(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "{") {
		if t := textFromResponseObject(trimmed); t != "" {
			return t
		}
		return raw
	}
	var sb strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var ev struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Delta struct {
				Text string `json:"text"`
			} `json:"delta"`
		}
		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}
		for _, c := range ev.Choices {
			sb.WriteString(c.Delta.Content)
		}
		sb.WriteString(ev.Delta.Text)
	}
	if sb.Len() == 0 {
		return raw
	}
	return sb.String()
}

func textFromResponseObject(s string) string {
	var resp struct {
		Choices []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal([]byte(s), &resp) != nil {
		return ""
	}
	var parts []string
	for _, c := range resp.Choices {
		if t := contentText(c.Message.Content); t != "" {
			parts = append(parts, t)
		}
	}
	if len(parts) == 0 {
		return contentText(resp.Content)
	}
	return strings.Join(parts, "\n")
}

// contentText 兼容 content 是字符串或 [{type:"text",text:"..."}] 数组两种形态。
func contentText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var arr []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &arr) == nil {
		var parts []string
		for _, a := range arr {
			if a.Text != "" {
				parts = append(parts, a.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}
