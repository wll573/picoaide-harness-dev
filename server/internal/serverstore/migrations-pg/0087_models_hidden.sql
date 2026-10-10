-- 0087: models.hidden —— 管理员「隐藏」模型（需求 §7.1「支持隐藏不需要的模型」）。
--
-- 为什么不复用「删除」：
--   现有 deleteModel 是**不可逆**的 —— 删行（价格、默认参数、模态配置全部丢失），渠道型
--   上游还要把名字写进排除名单防止被同步复活。「模型发现」(§7.1) 一次会拉回上游全部
--   `/models`，其中大量是管理员不想暴露给员工的（embedding、旧版本、测试模型）。
--   让管理员为了"不展示"而删掉、日后想恢复时再重新定价，是错误的代价结构。
--   隐藏 = 只改一个布尔：行、价格、参数原样保留，随时可恢复。
--
-- 与 `catalog_missing`（0080）的区别（两者都让模型不出现在客户端目录，但语义相反）：
--   catalog_missing —— **系统**判定：上游目录里已经没有它了（同步发现的事实）。
--   hidden          —— **管理员**意图：上游还有，但我不想让员工用。
--   两者**不得互相覆盖**：同步把 catalog_missing 清掉时不能顺手把 hidden 也清掉
--   （那样管理员的隐藏会在下一轮同步时悄悄失效）。所以是两列，不是一列多值。
--
-- 效果（由代码侧保证，不是 DDL）：hidden = TRUE 的模型
--   ① 不出现在客户端 /v1/models 目录（见 llmgateway.ListModels）；
--   ② 不可被路由命中（见路由过滤）——否则"目录里看不到、直接传 model 名却能用"，
--      隐藏就成了只对界面生效的假隐藏；
--   ③ 管理端列表仍能看到它（带「已隐藏」标记），以便恢复。
ALTER TABLE models ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- 自检（沿用 0080 的写法与判据口径）：列必须存在、boolean、缺省 false、NOT NULL。
-- 缺省必须是 false —— 若误成 true，升级后**所有**既有模型会一夜之间从客户端消失。
-- `NOT LIKE 'false%'` 而不是精确等于：PG 会把缺省回显成 `false` 或 `false::boolean`，
-- 两种都算对（0080 踩过同一处）。
DO $models_hidden_selfcheck$
DECLARE
  col_type TEXT;
  col_default TEXT;
  col_notnull BOOLEAN;
BEGIN
  SELECT data_type, COALESCE(column_default, ''), is_nullable = 'NO'
    INTO col_type, col_default, col_notnull
    FROM information_schema.columns
   WHERE table_name = 'models' AND column_name = 'hidden';
  IF col_type IS NULL THEN
    RAISE EXCEPTION '0087: models.hidden 未创建';
  END IF;
  IF col_type <> 'boolean' THEN
    RAISE EXCEPTION '0087: models.hidden 类型应为 boolean，实际为 %', col_type;
  END IF;
  IF col_default NOT LIKE 'false%' THEN
    RAISE EXCEPTION '0087: models.hidden 缺省应为 false，实际为 %', col_default;
  END IF;
  IF NOT col_notnull THEN
    RAISE EXCEPTION '0087: models.hidden 应为 NOT NULL（false = 未隐藏）';
  END IF;
END
$models_hidden_selfcheck$;
