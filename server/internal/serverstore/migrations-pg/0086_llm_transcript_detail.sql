-- 0086: LLM 审计明细 —— 补齐「Prompt/Response 审计」需求(§8.1)要求的可读字段。
--
-- 背景：0083 只落了 request_id/user_id/endpoint/model/存储态/状态码/字节数/哈希。
-- 这些够做「留存与完整性」，不够做「审计可读性」——需求 §8.1 要求审计页默认能看到
-- **用户和会话、工作区、模型和供应商、请求时间和耗时、输入/输出/总 Token、流式状态、
-- 错误原因**。缺列时这些只能在展示层留空，于是"字段为空"正是需求 §8.3 点名要修的缺陷。
--
-- 本次新增（全部 NOT NULL DEFAULT，老行按缺省读；升级不需要回填）：
--   1. `duration_ms`     —— 请求从进入中间件到响应结束的墙钟耗时。
--   2. `stream`          —— 客户端是否请求了流式（请求体 `stream:true`）。
--   3. `input_tokens` / `output_tokens` / `total_tokens` —— usage 口径。
--      与 `usage` 表同源（网关解析上游 usage 后落账），此处冗余一份是为了审计页
--      单表可读，不必 join 计量表（计量表按用户分区、口径随调价变化，审计不该依赖它）。
--   4. `provider`        —— 命中的上游供应商名（需求 §8.1「模型和供应商」）。
--   5. `session_id` / `workspace` —— 需求 §8.1「用户和会话」「工作区」。
--   6. `error_type` / `error_message` —— 需求 §8.1「错误原因」。上游 200 但截断、
--      或 in-band error 事件，都要能在这里看出**为什么**断了，而不是只有 status_code。
--
-- `audit_status` 新增取值 `incomplete`（列本身无 CHECK 约束，无需 DDL）：
--   pending     —— 已建行、请求进行中；
--   complete    —— 见过上游收尾标记，正常结束；
--   incomplete  —— 上游**未给收尾标记**就断了（截断/代理断开/in-band error）。
--                 这是本次改造的核心：此前"上游 200 + 截断"与"正常完成"在审计里
--                 完全同形，都记 complete —— 断流因此不可见、无法区分。
--   write_failed —— 本地写响应/落块失败（保持 0083 的既有语义）。
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS duration_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS stream BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS total_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '';
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS workspace TEXT NOT NULL DEFAULT '';
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS error_type TEXT NOT NULL DEFAULT '';
ALTER TABLE llm_transcripts ADD COLUMN IF NOT EXISTS error_message TEXT NOT NULL DEFAULT '';

-- 需求 §8.2「默认按会话和时间分页」+ 按会话筛选：会话维度的翻页走这条索引。
CREATE INDEX IF NOT EXISTS idx_llm_transcripts_session_time
    ON llm_transcripts(session_id, created_at DESC);

-- 需求 §8.1：异常请求要能单独筛出来（"断流/报错的有哪些"）。部分索引只覆盖非 complete 行，
-- 稳态下这张表绝大多数行是 complete，部分索引体积小、命中快。
CREATE INDEX IF NOT EXISTS idx_llm_transcripts_audit_status
    ON llm_transcripts(audit_status, created_at DESC)
    WHERE audit_status <> 'complete';
