-- 0087: 上游 API Key 的**成功率与最近错误**（需求 §7.3 管理端可观测性）。
--
-- 背景：0084 建了 Key 池，但它只记 `failure_count`（失败次数）与 `last_error_at`
--   （失败时刻）——管理端据此只能显示"这个 Key 失败过 3 次、最后一次是 10 分钟前"，
--   答不了需求 §7.3 要求的两个问题：**成功率是多少**、**最近一次错误是什么**。
--   运维拿到这两个问题的答案才能判断"是这把 Key 废了"还是"上游整体抖动"。
--
-- 本次新增：
--   1. `success_count` / `total_count` —— 成功率 = success_count / total_count。
--      两者都记（而不是只记 total 与 success）是为了让计数口径在 SQL 层可自证：
--      读面断言 `success_count <= total_count`，漂移当场可见。
--   2. `last_error_status` —— 最近一次失败的上游 HTTP 状态码（0 = 连接层失败/超时）。
--      与 `last_error_at` 配合即可区分"401 密钥失效"（连 0 都不到，直接不可恢复）
--      与"429 限流"（等冷却即可）。
--   3. `last_error_message` —— 最近一次失败的**可读原因**。
--      ⚠️ 只写网关自己产生的固定文案（如 "上游 401 未授权"），**绝不**写上游响应体
--      原文：那可能包含上游回显的 key、内部主机名或用户内容。写库前由调用方截断
--      到 200 字符（见 keypool.go 的 finish）。
--
-- 老行语义：success_count/total_count 缺省 0 ⇒ 成功率显示"暂无数据"（不是 0%）；
--   这与迁移 0078 的 size_bytes"老行同 0 按未知展示"是同一条纪律 —— 宁可显示未知，
--   不要用一个假数字冒充统计。
ALTER TABLE gateway_provider_api_keys ADD COLUMN IF NOT EXISTS success_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gateway_provider_api_keys ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gateway_provider_api_keys ADD COLUMN IF NOT EXISTS last_error_status INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gateway_provider_api_keys ADD COLUMN IF NOT EXISTS last_error_message TEXT NOT NULL DEFAULT '';
