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
// Anthropic messages 的非流式与 SSE、Responses API 的非流式与 SSE。取不出来时原样返回。
//
// 三种流各自的增量字段名不同（这是本函数必须分派的原因，不是冗余）：
//
//	· chat      ——  `choices[].delta.content`
//	· Anthropic ——  `delta.text`（`content_block_delta`）
//	· Responses ——  `delta`（字符串，事件 `response.output_text.delta`）
//
// 少了最后一种，Responses 流的审计会**退回整份 SSE 原文** —— 逐行 `data:` 加事件
// 头全塞进"模型回复"，管理员看到的是协议噪声而不是模型说了什么。
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
		// ⚠️ 三次解析而不是一次：三种流的 `delta` **同名不同形状**（chat 用
		// `choices[].delta.content`、Anthropic 用 `delta.text`、Responses 用裸字符串
		// `delta`）。把三者塞进同一个 struct 会因字段名重复而**互相把值冲成零**
		// （实测：三路同时失效，连原本能用的 Anthropic 路径也被拖坏）。
		// 一次结构化解析 + 一次裸串解析，是这里能做到的最小代价。
		var structured struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Delta struct {
				Text string `json:"text"`
			} `json:"delta"`
		}
		if json.Unmarshal([]byte(data), &structured) == nil {
			for _, c := range structured.Choices {
				sb.WriteString(c.Delta.Content)
			}
			sb.WriteString(structured.Delta.Text)
		}
		// Responses 的 `delta` 是裸字符串，结构化解不出来，单独取一次。
		var loose struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		}
		if json.Unmarshal([]byte(data), &loose) == nil && loose.Delta != "" {
			sb.WriteString(loose.Delta)
		}
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
