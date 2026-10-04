-- 0089: 上游可配的超时 / 重试 / 协议开关（需求 §7 缺口收口）。
--
-- 背景：需求 §7 要求每个模型端点支持「超时和重试策略」以及「Responses API 开关 /
-- Chat Completions 开关」。这三项此前**只有写死的常量**，没有逐上游配置面：
--   * 超时：出站 HTTP 客户端用包级常量，所有上游一个值；
--   * 重试：只有「同上游内换 Key」，上限硬编码 3 次，且不可关；
--   * 协议开关：协议为 openai/both 的上游**同时**承接 `/v1/chat/completions` 与
--     `/v1/responses`，管理员无法只留一种。内网自建推理服务常常只实现了其中一种，
--     另一种会返回难以理解的 404/400，而界面上看不出去哪关。
--
-- 默认值全部取「与今天完全一致」的那一组：
--   timeout_seconds   = 0    ⇒ 用内置默认超时（不改变现网行为）
--   max_key_attempts  = 0    ⇒ 用内置默认（3 次换 Key）
--   responses_enabled = TRUE / chat_enabled = TRUE ⇒ 两种协议都开
-- 于是升级后行为零变化，管理员按需收紧。
ALTER TABLE gateway_providers ADD COLUMN IF NOT EXISTS timeout_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gateway_providers ADD COLUMN IF NOT EXISTS max_key_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gateway_providers ADD COLUMN IF NOT EXISTS responses_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE gateway_providers ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 自检（沿用 0080 / 0088 的写法）：四个列都在，且缺省值就是"不改行为"的那一组。
-- 缺省值写反是最危险的一类错误 —— 比如 responses_enabled 缺省 false，升级后
-- 全平台 `/v1/responses` 会整体不可用，而报错现象与本次改动毫无关系。
DO $gw_provider_policy_selfcheck$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT count(*) INTO cnt FROM information_schema.columns
   WHERE table_name = 'gateway_providers'
     AND column_name IN ('timeout_seconds', 'max_key_attempts', 'responses_enabled', 'chat_enabled');
  IF cnt <> 4 THEN
    RAISE EXCEPTION '0089: gateway_providers 缺列（期望 4，实际 %）', cnt;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'gateway_providers' AND column_name = 'responses_enabled'
                AND column_default NOT LIKE 'true%') THEN
    RAISE EXCEPTION '0089: responses_enabled 缺省应为 true（否则升级后 /v1/responses 整体不可用）';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'gateway_providers' AND column_name = 'chat_enabled'
                AND column_default NOT LIKE 'true%') THEN
    RAISE EXCEPTION '0089: chat_enabled 缺省应为 true（否则升级后 /v1/chat/completions 整体不可用）';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'gateway_providers' AND column_name = 'timeout_seconds'
                AND column_default NOT LIKE '0%') THEN
    RAISE EXCEPTION '0089: timeout_seconds 缺省应为 0（0 = 用内置默认超时）';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'gateway_providers' AND column_name = 'max_key_attempts'
                AND column_default NOT LIKE '0%') THEN
    RAISE EXCEPTION '0089: max_key_attempts 缺省应为 0（0 = 用内置默认次数）';
  END IF;
END
$gw_provider_policy_selfcheck$;
