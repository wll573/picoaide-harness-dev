package llmgateway

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/picoaide/picoaide/internal/serverstore"
)

type UpstreamKey struct {
	ID  int64
	Key string
}

// errNoAvailableKey 表示池里**没有**（剩余的）可用 Key：全部在冷却/被停用，或剩下的
// 都已在本次请求里试过。它与"池为空/密钥解密失败"区分开，换 Key 重试循环据此知道
// "该收手了"而不是"出错了"。
var errNoAvailableKey = errors.New("all upstream API keys are cooling down, disabled or already tried")

// globalPollCursor 是**跨上游**的全局轮询游标（0089，需求 §7.3「所有启用 Key 使用全局
// 轮询池」）。
//
// 修前的实际行为：候选上游按 id 升序（MatchModelsByProtocol 的 ORDER BY id），每个上游
// 内部按自己的游标轮询 Key。于是第一个上游**永远**先被选中 —— 只有它整体冷却/失败时
// 才轮到第二个。这与"全局轮询池"不是一回事：多上游场景下流量压在 id 最小的那个，
// 其余长期闲置，而需求要的是所有 Key 均匀分摊。
//
// 这里用一个进程级递增计数器旋转**候选上游的顺序**；上游内部的 Key 仍按各自游标轮询。
// 两者合起来 = 所有上游的所有 Key 参与同一轮轮询。
//
// 为什么不做成"把（上游，Key）拍平成一个池"：那会让 chosenProviderID（计费取价的依据）
// 与"这次用哪把 Key"耦合在一起，重试跨上游时的**计费归属**变得难以解释 —— 而计费口径
// 是这个系统里最不该被顺带改动的东西。旋转候选顺序达到同样的分摊效果，且每次请求的
// 归属仍然只由"实际服务它的那个上游"决定。
var globalPollCursor uint64

// rotateCandidates 按全局游标旋转候选上游列表（长度 < 2 时原样返回）。
func rotateCandidates(ups []Upstream) []Upstream {
	if len(ups) < 2 {
		return ups
	}
	n := atomic.AddUint64(&globalPollCursor, 1)
	off := int(n % uint64(len(ups)))
	out := make([]Upstream, 0, len(ups))
	out = append(out, ups[off:]...)
	out = append(out, ups[:off]...)
	return out
}

// maxKeyAttemptsPerProvider 是**单次请求在同一个 provider 内**最多尝试的 Key 个数
// （含第一次）。需求 §7.3：「单次请求限制切换次数，避免无限重试」。
//
// 取 3 的理由：池里通常 2~5 把 Key；再多的重试只会在上游整体故障（而不是单 Key 问题）
// 时放大流量 —— 每次重试都是一次真实的上游调用，会占用限流额度并拉长用户等待。
// 上限是**硬上限**，不随池大小增长。
const maxKeyAttemptsPerProvider = 3

// keyAttemptRetryable 判定一次 Key 尝试的结果能否换一把 Key 重试。
//
// 只在**确定没有产生可交付内容、且换 Key 有可能改变结果**时才重试（需求 §7.3：
// 「429、限流、超时、连接失败和可重试 5xx 自动切换 Key」）：
//
//	err != nil          ⇒ 连接失败/超时/5xx（forward 把 ≥500 转成了 error）→ 重试
//	401 / 403           ⇒ 这把 Key 不可恢复 → 重试（换一把也许是好的）
//	429                 ⇒ 这把 Key 被限流 → 重试
//	其它 4xx（400/404…）  ⇒ **请求本身有问题**，换 Key 结果一样 → 不重试，原样返回
//	2xx/3xx             ⇒ 成功 → 不重试
//
// ⚠️ 计费正确性：这里只看**响应状态**，从不在已经开始向客户端写出内容之后重试。
// 重试发生在 forward 返回之后、serveStream/serveJSON 开始写之前，所以不存在
// "已交付一半内容又整个重来一遍"（那会双倍计费并让客户端看到两段拼接的内容）。
func keyAttemptRetryable(resp *http.Response, err error) bool {
	if err != nil {
		// **本地拒绝**不是上游问题，换 Key 重试只会重复同一个拒绝：
		//   errBodyParseBusy       —— 本进程的请求体解析闸门打满（503）；
		//   errOutboundBodyNotJSON —— 出站体不是 JSON 对象（400）。
		// 这两类由调用方的 rejectForwardError 收口并立即返回，必须原样传出去，
		// 否则会被当成"连接失败"重试 3 次（每次都再占一次闸门、再写一遍日志）。
		if errors.Is(err, errBodyParseBusy) || errors.Is(err, errOutboundBodyNotJSON) {
			return false
		}
		return true
	}
	if resp == nil {
		return false
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusTooManyRequests:
		return true
	}
	return false
}

// forwardSendFunc 是一次"用给定的 attempt（含选中的 Key）把请求发给上游"的动作。
// 各端点差异只在 URL 与协议适配（forward / forwardEndpoint / forwardAnthropic），
// 重试策略完全一致 —— 所以把动作作为参数传入，而不是把重试逻辑抄 5 遍。
//
// 形参是 `up` 而不是"整个请求体 + gin.Context"：**请求体由闭包从外层捕获**。
// 这不是风格选择，而是一条硬约束：`outbound_identity_test.go` 的
// TestForwardHelpersReceiveProcessedBody 会用 AST 断言"每个 forward* 调用的
// 实参必须派生自 prepareOutboundBody"。那条守卫的分析是**函数级**的，但
// `ast.Inspect` 会走进嵌套的函数字面量 —— 闭包捕获的外层变量因此仍被判据看见；
// 而把请求体改成闭包的**形参**（`func(c, up, b, stream)`）会让守卫看到 `b`
// 是个普通形参、与 prepareOutboundBody 无关联，于是判红（实测）。
type forwardSendFunc func(up *Upstream) (*http.Response, error)

// forwardWithKeyRetry 在**同一个 provider 内**换 Key 重试，返回最终结果。
//
// 解决的问题（需求 §7.3）：此前每个 provider 只取一把 Key、只试一次。一次请求打到
// 正在冷却的 Key 上就整个失败（`all upstream API keys are cooling down`），
// 哪怕池里还有健康的 Key。
//
// 三条不变量：
//
//	① **最多 maxKeyAttemptsPerProvider 次**（含首次），硬上限不随池大小增长；
//	② **不重复用同一把 Key** —— 把失败过的那把排除（否则池里只有一把时会空转）；
//	③ **不重试已产生交付内容的响应** —— 只按 keyAttemptRetryable 的状态判定，
//	   绝不在写出一半内容后重来（计费与客户端体验都会坏掉）。
//
// 每次失败的尝试都经 recordLeaseResponse 记进 Key 池（冷却/失败计数/成功率），
// 所以"这把 Key 又坏了一次"在管理端可见 —— 重试不是把错误藏起来。
func (a *API) forwardWithKeyRetry(c *gin.Context, up Upstream, send forwardSendFunc) (Upstream, *keyLease, *http.Response, error) {
	var tried []int64
	var lastErr error
	var lastResp *http.Response
	attempt := up

	// 0089（需求 §7「重试策略」）：次数由上游配置决定，0 = 内置默认。
	// 下限 1 —— 0 已经表示"用默认"，不能再让 0 变成"一次都不试"。
	maxAttempts := up.MaxKeyAttempts
	if maxAttempts <= 0 {
		maxAttempts = maxKeyAttemptsPerProvider
	}

	for n := 0; n < maxAttempts; n++ {
		var lease *keyLease
		var keyErr error
		attempt, lease, keyErr = a.upstreamWithKeyExcluding(up, tried)
		if keyErr != nil {
			// 这个 provider 没有（剩余的）可用 Key。**必须把 keyErr 作为错误返回**，
			// 而不是返回 lastErr（首轮时它是 nil）：
			//   - 返回 nil 错误 ⇒ 调用方走「成功」分支（`if err == nil` 里设
			//     chosenProviderID 并 break）⇒ **跳过后面的候选 provider**，
			//     而它们可能本来有健康的 Key；
			//   - 返回 keyErr ⇒ 调用方记一条日志并继续下一个候选（原有语义）。
			// 仅当已经试过至少一把（说明是本轮重试耗尽）时才回 lastErr，
			// 让调用方看到真实的上游失败原因而不是"没有 Key"。
			if len(tried) == 0 {
				return attempt, nil, nil, keyErr
			}
			return attempt, nil, lastResp, lastErr
		}
		// 无法区分 Key 的情形必须**只试一次**：
		//   lease == nil        ⇒ 本 API 没有密钥池（测试/裸配置），用的是 up.APIKey；
		//   lease.KeyID() == 0  ⇒ 池里一行都没有，回落到了 up.APIKey。
		// 两种情况下"换 Key"根本无从谈起，重试只会拿同一把 Key 再打两次上游 ——
		// 唯一效果是放大流量并让用户多等。直接返回，交由上层的 provider 级 failover 处理。
		if lease == nil || lease.KeyID() == 0 {
			resp, err := send(&attempt)
			recordLeaseResponse(lease, resp, err)
			return attempt, lease, resp, err
		}
		tried = append(tried, lease.KeyID())
		resp, err := send(&attempt)
		recordLeaseResponse(lease, resp, err)
		if !keyAttemptRetryable(resp, err) {
			return attempt, lease, resp, err
		}
		// 可重试：先释放这一轮的响应体，避免连接泄漏（forward 已把这些路径的状态码
		// 归为失败，正文不会再被读）。
		if resp != nil && resp.Body != nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			resp.Body.Close()
		}
		lastErr, lastResp = err, nil
		if err == nil {
			lastErr = fmt.Errorf("upstream key rejected (status %d)", resp.StatusCode)
		}
		log.Printf("gateway: provider %q key attempt %d/%d failed, switching key: %v",
			up.Name, n+1, maxAttempts, lastErr)
	}
	// 用尽次数：把最后一次的失败带回去，交由调用方按既有语义处理。
	return attempt, nil, nil, lastErr
}

// KeyID 暴露租约绑定的 Key id（0 = 无池/回落 Key）。重试循环用它记账"哪些已试过"。
func (l *keyLease) KeyID() int64 {
	if l == nil {
		return 0
	}
	return l.keyID
}

type keyLease struct {
	pool       *providerKeyPool
	providerID int64
	keyID      int64
	apiKey     string
	once       sync.Once
}

func (l *keyLease) APIKey() string { return l.apiKey }
func (l *keyLease) Success()       { l.finish(0, 0, false) }
func (l *keyLease) Failure(status int, retryAfter string) {
	l.finish(status, parseRetryAfter(retryAfter), true)
}
func (l *keyLease) NetworkFailure() { l.finish(0, 5*time.Second, true) }
func (l *keyLease) finish(status int, retryAfter time.Duration, failed bool) {
	if l == nil {
		return
	}
	l.once.Do(func() { l.pool.finish(l.providerID, l.keyID, status, retryAfter, failed) })
}

type providerKeyPool struct {
	db   *sql.DB
	mu   sync.Mutex
	next map[int64]int
}

func (p *providerKeyPool) acquireLease(providerID int64, fallback string) (*keyLease, error) {
	return p.acquire(providerID, fallback)
}

func newProviderKeyPool(db *sql.DB) *providerKeyPool {
	return &providerKeyPool{db: db, next: make(map[int64]int)}
}

func (p *providerKeyPool) acquire(providerID int64, fallback string) (*keyLease, error) {
	return p.acquireExcluding(providerID, fallback, nil)
}

// acquireExcluding 与 acquire 相同，但跳过 exclude 里的 Key id。
//
// 用途（0089/需求 §7.3「单次请求限制切换次数」）：同一个 provider 内换 Key 重试时，
// 必须把**刚失败的那把**排除掉。只靠轮询游标是不够的 —— 池里只有一把 Key 时，
// 下次 acquire 必然又转回它，于是"换 Key 重试"退化成"对同一把坏 Key 重试三次"，
// 白白多打三次上游（还多扣三次限流额度）。
func (p *providerKeyPool) acquireExcluding(providerID int64, fallback string, exclude []int64) (*keyLease, error) {
	keys, err := serverstore.ListGatewayProviderAPIKeys(p.db, providerID)
	if err != nil {
		return nil, err
	}
	skip := make(map[int64]struct{}, len(exclude))
	for _, id := range exclude {
		skip[id] = struct{}{}
	}
	now := time.Now()
	available := make([]serverstore.GatewayProviderAPIKey, 0, len(keys))
	for _, key := range keys {
		if _, excluded := skip[key.ID]; excluded {
			continue
		}
		if key.Enabled && (key.CooldownUntil == nil || !key.CooldownUntil.After(now)) {
			available = append(available, key)
		}
	}
	if len(available) == 0 {
		if len(keys) > 0 {
			// 已排除的 Key 不算"可用" —— 换 Key 重试到此为止。
			return nil, errNoAvailableKey
		}
		if fallback == "" {
			return nil, errors.New("no upstream API key available")
		}
		return &keyLease{pool: p, providerID: providerID, apiKey: fallback}, nil
	}
	p.mu.Lock()
	index := p.next[providerID] % len(available)
	p.next[providerID] = (index + 1) % len(available)
	p.mu.Unlock()
	key := available[index]
	plain, err := DecryptSecret(key.APIKeyEnc)
	if err != nil {
		return nil, err
	}
	return &keyLease{pool: p, providerID: providerID, keyID: key.ID, apiKey: plain}, nil
}

// finish 把一次 Key 使用的结局写回 `gateway_provider_api_keys`。
//
// R27：该表已收进族内关系（与父表 `gateway_providers` 同族）—— 裸池写会落到 shadow
// 同名表上，表现是"冷却/失败计数/成功率永远不生效"而没有任何错误面（下一次仍然挑了
// 一把已冷却的 Key，反复失败）。因此这里必须走 serverstore 的跨包接缝
// `WithUsageSearchPath`；包外**不允许**自己 `db.Begin()` + `SET LOCAL`。
//
// 失败分支的 SELECT + UPDATE 放在**同一个事务**里：读-改-写之间被并发请求插入时，
// 两次 finish 会各自读到同一个 failure_count 并写回同一个值（丢失一次失败），
// 退避时长因此比预期短。事务内顺序执行把这一处收成原子的。
func (p *providerKeyPool) finish(providerID, keyID int64, status int, retryAfter time.Duration, failed bool) {
	if keyID == 0 {
		return
	}
	if !failed {
		// 0087（需求 §7.3）：成功要计入分母与分子 —— 只记失败数答不了"成功率是多少"。
		// failure_count 归零（连续失败计数），但 **total_count / success_count 只增不减**
		// （那是累计统计，不是"当前状态"）。
		_ = serverstore.WithUsageSearchPath(p.db, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE gateway_provider_api_keys
				SET failure_count = 0, success_count = success_count + 1, total_count = total_count + 1,
				    cooldown_until = NULL, last_used_at = now(), updated_at = now()
				WHERE provider_id = ? AND id = ?`, providerID, keyID)
			return err
		})
		return
	}
	cooldown := retryAfter
	// 0087（需求 §7.3）：失败也要计入分母，并记下**最近错误的可读原因**。
	//
	// ⚠️ last_error_message 只写本函数自己产生的固定文案，**绝不**写上游响应体原文：
	// 上游（或中转）在错误体里回显请求头/内部主机名/用户内容都发生过，而这一列会在
	// 管理端明文展示。截断到 200 字符防止异常长值撑爆页面。
	_ = serverstore.WithUsageSearchPath(p.db, func(tx *sql.Tx) error {
		var count int
		// 读不到（Key 行已被删）时按 1 次失败计：退避仍要生效，不能因为读失败就退化成"不冷却"。
		_ = tx.QueryRow(`SELECT failure_count FROM gateway_provider_api_keys WHERE provider_id = ? AND id = ?`, providerID, keyID).Scan(&count)
		count++
		if cooldown <= 0 {
			switch status {
			case http.StatusUnauthorized, http.StatusForbidden:
				cooldown = 10 * time.Minute
			case http.StatusTooManyRequests:
				seconds := math.Pow(2, float64(minInt(count-1, 5))) * 30
				cooldown = time.Duration(seconds) * time.Second
			default:
				cooldown = 5 * time.Second
			}
		}
		if cooldown > 30*time.Minute {
			cooldown = 30 * time.Minute
		}
		_, err := tx.Exec(`UPDATE gateway_provider_api_keys
			SET failure_count = ?, total_count = total_count + 1,
			    last_error_status = ?, last_error_message = ?,
			    cooldown_until = ?, last_error_at = now(), updated_at = now()
			WHERE provider_id = ? AND id = ?`,
			count, status, truncateRunes(keyFailureReason(status), 200), time.Now().Add(cooldown), providerID, keyID)
		return err
	})
}

// keyFailureReason 把上游状态码翻译成管理端可读的原因（只陈述网关观察到的分类，
// 不引用上游原文）。文案与 gateway 页面现有的状态文案口径一致。
func keyFailureReason(status int) string {
	switch {
	case status == 0:
		return "连接失败或超时（未收到上游响应）"
	case status == http.StatusUnauthorized:
		return "上游 401 未授权（Key 可能已失效）"
	case status == http.StatusForbidden:
		return "上游 403 拒绝（Key 无权限或已被封禁）"
	case status == http.StatusTooManyRequests:
		return "上游 429 限流"
	case status >= 500:
		return "上游 5xx 服务错误"
	default:
		return "上游返回 " + strconv.Itoa(status)
	}
}

// truncateRunes 按**字符**（不是字节）截断，避免把一个多字节 UTF-8 字符切成半个
// （那会在管理端显示成乱码）。
func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil {
		return time.Until(at)
	}
	return 0
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (a *API) upstreamWithKey(up Upstream) (Upstream, *keyLease, error) {
	return a.upstreamWithKeyExcluding(up, nil)
}

// upstreamWithKeyExcluding 取一把 Key 并把它装进 Upstream；exclude 里的 Key 不会被选中。
func (a *API) upstreamWithKeyExcluding(up Upstream, exclude []int64) (Upstream, *keyLease, error) {
	if a == nil || a.keyPool == nil {
		return up, nil, nil
	}
	lease, err := a.keyPool.acquireExcluding(up.ID, up.APIKey, exclude)
	if err != nil {
		return up, nil, err
	}
	up.APIKey = lease.APIKey()
	return up, lease, nil
}

func recordLeaseResponse(lease *keyLease, resp *http.Response, err error) {
	if lease == nil {
		return
	}
	if err != nil {
		lease.NetworkFailure()
		return
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		lease.Success()
		return
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		lease.Failure(resp.StatusCode, resp.Header.Get("Retry-After"))
		return
	}
	if resp.StatusCode >= 500 {
		lease.NetworkFailure()
		return
	}
	lease.Success()
}
