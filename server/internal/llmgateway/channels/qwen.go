package channels

import (
	"context"
	"strings"
)

// Qwen 渠道:Qwen 系列模型 OpenAI 兼容 API(vLLM 部署)。
//
// 思考参数差异:
//   - Qwen 兼容模式用 enable_thinking/thinking_budget 控制思考
//   - 客户端(DeepSeek 风格)用 thinking.type + reasoning_effort(off/low/high/max)
//   - Qwen 不认识 thinking 字段,需剔除
//   - 客户端的 reasoning_effort 只用于推导 enable_thinking,不直接发给 Qwen
type Qwen struct{}

func init() { Register(Qwen{}) }

func (Qwen) Name() string    { return "qwen" }
func (Qwen) BaseURL() string { return "http://localhost:8000/v1" }

// FetchModels:从 vLLM /models 拉取目录,OpenAI 兼容格式。
func (q Qwen) FetchModels(ctx context.Context, apiKey string, fetchFn func(url string) ([]byte, error)) ([]ModelInfo, error) {
	f := fetchFn
	if f == nil {
		f = func(url string) ([]byte, error) { return HTTPFetch(ctx, url, apiKey) }
	}
	body, err := f(q.BaseURL() + "/models")
	if err != nil {
		return nil, err
	}
	return ParseOAIModels(body)
}

// RequestOverrides Qwen 渠道的静态覆盖为空;动态参数转换由 TransformRequestBody 处理。
func (Qwen) RequestOverrides(modelID string) (map[string]any, []string) {
	return nil, nil
}

// TransformRequestBody 把客户端统一的思考参数转换成 Qwen 兼容模式的请求体。
//
// 转换规则:
//  1. 读取 thinking.type 和 reasoning_effort,计算是否启用思考
//  2. 删除 thinking 字段(Qwen 不认识该结构)
//  3. 输出 enable_thinking 和可选 thinking_budget
//  4. 不把 reasoning_effort 发给 Qwen(兼容模式会拒绝该字段)
func (q Qwen) TransformRequestBody(body map[string]any) bool {
	// 1. 解析当前思考状态。
	thinkingObj, _ := body["thinking"].(map[string]any)
	thinkingType := strings.ToLower(strings.TrimSpace(stringValue(thinkingObj["type"])))
	effort := strings.ToLower(strings.TrimSpace(stringValue(body["reasoning_effort"])))
	configured := thinkingType != "" || effort != "" || body["thinking_budget"] != nil || body["enable_thinking"] != nil
	enabled := false
	if value, ok := body["enable_thinking"].(bool); ok {
		enabled = value
	}
	if thinkingType == "enabled" || thinkingType == "enable" || thinkingType == "on" || thinkingType == "true" {
		enabled = true
	}
	if thinkingType == "disabled" || thinkingType == "disable" || thinkingType == "off" || thinkingType == "false" || effort == "off" {
		enabled = false
	}

	budget, hasBudget := numberValue(body["thinking_budget"])
	changed := false

	// 3. 删除 DeepSeek 的 thinking 字段
	if _, hasThinking := body["thinking"]; hasThinking {
		delete(body, "thinking")
		changed = true
	}

	if _, hasEffort := body["reasoning_effort"]; hasEffort {
		delete(body, "reasoning_effort")
		changed = true
	}

	if configured {
		if body["enable_thinking"] != enabled {
			body["enable_thinking"] = enabled
			changed = true
		}
		if hasBudget && budget > 0 {
			if body["thinking_budget"] != budget {
				body["thinking_budget"] = budget
				changed = true
			}
		} else if _, exists := body["thinking_budget"]; exists {
			delete(body, "thinking_budget")
			changed = true
		}
	}

	return changed
}

// DefaultModelCaps:使用兼容模式可安全接受的默认规格；管理员仍可按模型覆盖。
func (q Qwen) DefaultModelCaps() (int64, int64) {
	return 131072, 8192
}
