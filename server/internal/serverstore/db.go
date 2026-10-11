package serverstore

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// pgInt64Array 把 []int64 编码成 PG 数组字面量("{1,2,3}"),配合 SQL 侧
// `= ANY(?::bigint[])` 使用(P2-7:成员集合走数组参数,避免拼 IN(?,?,…)
// 撞 PG 65535 参数上限 → 配额校验 fail-closed 全员 429)。
// 为什么传文本字面量而不是 []int64:database/sql 默认参数转换器不认识切片,
// 而 pgx 的切片编码又被 rewrite 包装层挡在 CheckNamedValue 之外
// ("unsupported type []int64");字符串参数走 pgx 的 text 编码,
// 由 SQL 的显式 ::bigint[] 转换解析。
func pgInt64Array(ids []int64) string {
	var b strings.Builder
	b.Grow(len(ids)*8 + 2)
	b.WriteByte('{')
	for i, id := range ids {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatInt(id, 10))
	}
	b.WriteByte('}')
	return b.String()
}

// pgFloat64Array 把 []float64 编码成 PG 数组字面量(配合 ::double precision[]),
// 用于余额账本的批量流水写入(unnest 展开)。理由同 pgInt64Array。
func pgFloat64Array(vals []float64) string {
	var b strings.Builder
	b.Grow(len(vals)*16 + 2)
	b.WriteByte('{')
	for i, v := range vals {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(roundMicro(v), 'f', -1, 64))
	}
	b.WriteByte('}')
	return b.String()
}

// DriverName identifies the underlying SQL backend (PostgreSQL only.
// SQLite support was removed in the PG-only migration).
type DriverName string

const (
	DriverPG DriverName = "pg"
)

// DBConfig selects the backend for Open.
type DBConfig struct {
	Driver DriverName // "pg" (default)
	DSN    string     // pg connection string (postgres:// or keyword DSN)
}

// Open opens the requested backend and verifies connectivity.
func Open(cfg DBConfig) (*sql.DB, error) {
	switch cfg.Driver {
	case "", DriverPG:
		return openPG(cfg.DSN)
	default:
		return nil, fmt.Errorf("unsupported db driver %q (want pg)", cfg.Driver)
	}
}

// NowExpr returns the backend-specific expression for "current timestamp".
// PG uses now() with TIMESTAMPTZ (both scan back to local time via parseSQLTime).
func NowExpr() string {
	return "now()"
}

// TimestampType returns the column type for timestamp columns.
func TimestampType() string {
	return "TIMESTAMPTZ"
}

// CaseInsensitiveCmp returns the SQL snippet comparing a column to a value
// case-insensitively. PG uses LOWER(col)=LOWER(?).
func CaseInsensitiveCmp(col string) string {
	return fmt.Sprintf("LOWER(%s) = LOWER(?)", col)
}

// InsertID executes an INSERT and returns the auto-generated row id.
// PG: pgx stdlib does not implement LastInsertId, so we append RETURNING id
// and QueryRow-scan it.
func InsertID(db *sql.DB, query string, args ...any) (int64, error) {
	return insertID(db, query, args...)
}

// InsertIDTx 与 InsertID 是同一实现,只是跑在调用方事务内(2026-09-19:
// createModel 的"移出排除名单 + 建模型行"要原子,建行必须走事务内版本;
// SQL 与 RETURNING 追加逻辑只有这一份)。
func InsertIDTx(tx *sql.Tx, query string, args ...any) (int64, error) {
	return insertID(tx, query, args...)
}

// rowQuerier 覆盖 *sql.DB 与 *sql.Tx(两者都有 QueryRow),让 InsertID /
// InsertIDTx 共用同一条语句与同一个 RETURNING 追加逻辑。
type rowQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func insertID(q rowQuerier, query string, args ...any) (int64, error) {
	var id int64
	err := q.QueryRow(query+" RETURNING id", args...).Scan(&id)
	return id, err
}

// openPG opens a PostgreSQL database via pgx stdlib. Wraps the connector with
// the `?` -> `$N` rewrite layer: the codebase's SQL statements all use `?`
// placeholders (kept for portability), and pgx requires $N. Configures a pool
// sized for the gateway's concurrency and the Asia/Shanghai session timezone.
// pgErrorIsTransient 判断一个连接错误是否属于"数据库还没准备好"这类**值得重试**
// 的暂时性故障。判据用 SQLSTATE（去见 reports.go 的同族说明：不匹配错误串，
// 错误串的形状由驱动决定，换个版本就变）。
//
//	57P03  cannot_connect_now      —— 数据库正在启动（compose/CI 并行拉起的常态）
//	08006  connection_failure      —— 连接中途失效
//	08001  sqlclient_unable_to_establish_sqlconnection
//	08004  sqlserver_rejected_establishment_of_sqlconnection
//	53300  too_many_connections    —— 稍后重试有意义
//
// 口令错（28P01）、库不存在（3D000）等**不在此列**：重试多少次结果都一样，
// 应立即失败并说清原因。
func pgErrorIsTransient(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "57P03", "08006", "08001", "08004", "53300":
			return true
		default:
			return false
		}
	}
	// 非 PgError：连接根本没能建立（DNS 解析失败、拒绝连接、超时）。
	// 这几种同样值得重试（PG 可能正在启动，端口还没监听）。
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	msg := err.Error()
	for _, s := range []string{"connection refused", "connection reset", "no such host",
		"i/o timeout", "network is unreachable", "database system is starting up"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// redactDSN 把连接串里的口令替换成 ***，用于日志与错误信息。
//
// 为什么必须做：启动失败的报错会进 journalctl，而 journal 默认对 adm 组与
// systemd-journal 组可读。原文打印等于把数据库口令写进日志。
func redactDSN(dsn string) string {
	// postgres://user:password@host:port/db?...
	if i := strings.Index(dsn, "://"); i >= 0 {
		rest := dsn[i+3:]
		at := strings.LastIndex(rest, "@")
		colon := strings.Index(rest, ":")
		if at > 0 && colon > 0 && colon < at {
			return dsn[:i+3] + rest[:colon] + ":***" + rest[at:]
		}
		return dsn
	}
	// key=value 形态（password=...）
	out := dsn
	for _, key := range []string{"password=", "PASSWORD="} {
		for {
			i := strings.Index(out, key)
			if i < 0 {
				break
			}
			j := i + len(key)
			k := strings.IndexAny(out[j:], " \t")
			if k < 0 {
				out = out[:j] + "***"
				break
			}
			out = out[:j] + "***" + out[j+k:]
		}
	}
	return out
}

func openPG(dsn string) (*sql.DB, error) {
	if dsn == "" {
		return nil, errors.New("pg dsn required")
	}
	connector, err := newPGConnector(dsn)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(&rewriteConnector{raw: connector})
	// 启动竞态容忍:PG 与 server 并行拉起时(compose/CI 验证),连接可能撞上
	// "database system is starting up"(SQLSTATE 57P03)。重试 30 次 × 1s,
	// 逾期返回最后一次错误(服务端配合 CI docker.yml 的 Verify 步骤双保险)。
	//
	// 2026-10（原生 systemd 部署发现）：**只对暂时性错误重试**。
	// 旧实现不看错误类型，对"口令错 / 库不存在 / 主机名写错"这类永远不会成功的
	// 错误也一样重试 30 次 —— 且期间**一行日志都不打**。实测：把 DSN 口令写错后
	// 启动，15 秒内既不退出也无任何输出；在 systemd 下表现为"服务反复重启、
	// journal 全是空的"，排障只能靠猜。现在：
	//   * 连接类错误（57P03 启动中、08006/08001/08004 连接失败、超时、网络不可达）→ 重试；
	//   * 其余（28P01 口令错、3D000 库不存在、42P01 等）→ **立即失败**，并把
	//     DSN 里的口令隐去后打进日志，让人一眼看出连的是哪个库、失败原因是什么。
	var lastErr error
	for attempt := 0; attempt < 30; attempt++ {
		err := db.Ping()
		if err == nil {
			lastErr = nil
			break
		}
		lastErr = err
		if !pgErrorIsTransient(err) {
			db.Close()
			return nil, fmt.Errorf("pg connect %s: %w", redactDSN(dsn), err)
		}
		if attempt == 0 || (attempt+1)%5 == 0 {
			log.Printf("db: 等待数据库就绪（第 %d/30 次）：%v（DSN %s）", attempt+1, err, redactDSN(dsn))
		}
		time.Sleep(time.Second)
	}
	if lastErr != nil {
		db.Close()
		return nil, fmt.Errorf("pg ping %s: %w", redactDSN(dsn), lastErr)
	}
	// 连接池:实测 500 并发 1257 TPS / 3000 突发 1613 writes/s 0 失败;
	// 200 连接 + 业务层(流式 1-3s 打散)足以支撑数千并发大模型调用。
	// PG MVCC 多写并行,无需 SQLite 的单连接串行化。
	// 2026-08-31 实测（100tok/s 长流 2000 并发）: 池 200 时流式回填风暴
	// 打满池 -> database/sql 连接饥饿全站僵死(1490 goroutine 卡 waitForConn)。
	// 上调 400 + 短 IdleTime 淘汰半死连接(僵死元凶是"坏连接占池位不可复用")。
	//
	// 2026-09-13(N-2③):400 是**愿望值**,而 PG 侧的硬上限是
	// max_connections - superuser_reserved_connections(默认 100-3)。池超过
	// 这个数时,database/sql 会真的去开第 N+1 条连接,PG 直接回
	// "too many clients"——请求**报错而不是排队**,而拿到连接的那部分请求
	// 也未必能推进。这里按服务端实际可授予量收紧(留 4 条给运维/迁移/其它
	// 实例),并把连接获取失败变成排队;探测失败则回落到保守的 90。
	db.SetMaxOpenConns(pgPoolMax(db))
	db.SetMaxIdleConns(100)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)
	return db, nil
}

// pgPoolMaxWithProbe / pgPoolMaxWithoutProbe:pgPoolMax 的两个分支常量。
const (
	pgPoolMaxCeiling    = 400 // 历史愿望值(见 openPG 注释)
	pgPoolMaxFallback   = 90  // 探测失败时的保守值(PG 默认 max_connections=100)
	pgPoolReservedSlots = 4   // 留给运维连接/迁移/同库的其它实例
)

// pgPoolMax 返回应用连接池上限:min(400, 服务端可授予量, 显式覆盖)。
// PICOAI_DB_MAX_OPEN_CONNS 可显式指定(多实例部署/托管 PG 时按实际配额下调)。
func pgPoolMax(db *sql.DB) int {
	max := pgPoolMaxCeiling
	if usable, err := pgUsableConnections(db); err != nil {
		log.Printf("serverstore: SHOW max_connections failed (%v); capping pool at %d", err, pgPoolMaxFallback)
		max = pgPoolMaxFallback
	} else if usable < max {
		max = usable
	}
	if v := strings.TrimSpace(os.Getenv("PICOAI_DB_MAX_OPEN_CONNS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n < max {
				max = n
			}
		} else {
			log.Printf("serverstore: ignoring invalid PICOAI_DB_MAX_OPEN_CONNS=%q", v)
		}
	}
	if max < 2 { // 发布路径的最小可用池:同一时刻 1 条连接即可,但 2 是安全地板
		max = 2
	}
	return max
}

// pgUsableConnections 是 PG 实际能授予普通连接的条数(总连接数减去超级用户
// 保留位与给运维留的余量)。
func pgUsableConnections(db *sql.DB) (int, error) {
	var maxConn, reserved int
	if err := db.QueryRow(`SHOW max_connections`).Scan(&maxConn); err != nil {
		return 0, err
	}
	if err := db.QueryRow(`SHOW superuser_reserved_connections`).Scan(&reserved); err != nil {
		return 0, err
	}
	usable := maxConn - reserved - pgPoolReservedSlots
	if usable < 2 {
		usable = 2
	}
	return usable, nil
}

// ---------------------------------------------------------------------------
// `?` -> `$N` rewrite layer.
//
// PostgreSQL's extended protocol uses $1..$N positional parameters, not `?`.
// All SQL in this codebase is written with `?` for SQLite compatibility. We
// wrap the pgx database/sql connector so every prepared/executed statement has
// `?` rewritten to $1..$N before reaching PostgreSQL.
// ---------------------------------------------------------------------------

type rewriteConnector struct {
	raw driver.Connector
}

func (rc *rewriteConnector) Connect(ctx context.Context) (driver.Conn, error) {
	c, err := rc.raw.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &rewriteConn{Conn: c}, nil
}

func (rc *rewriteConnector) Driver() driver.Driver {
	return rc.raw.Driver()
}

type rewriteConn struct {
	driver.Conn
}

var (
	_ driver.Conn               = (*rewriteConn)(nil)
	_ driver.ConnPrepareContext = (*rewriteConn)(nil)
	_ driver.ExecerContext      = (*rewriteConn)(nil)
	_ driver.QueryerContext     = (*rewriteConn)(nil)
	_ driver.Pinger             = (*rewriteConn)(nil)
)

func (c *rewriteConn) rewrite(q string) string { return rewritePlaceholders(q) }

func (c *rewriteConn) Prepare(query string) (driver.Stmt, error) {
	return c.PrepareContext(context.Background(), query)
}

func (c *rewriteConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	if pc, ok := c.Conn.(driver.ConnPrepareContext); ok {
		return pc.PrepareContext(ctx, c.rewrite(query))
	}
	return c.Conn.Prepare(c.rewrite(query))
}

func (c *rewriteConn) Ping(ctx context.Context) error {
	if p, ok := c.Conn.(driver.Pinger); ok {
		return p.Ping(ctx)
	}
	return nil
}

func (c *rewriteConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if ec, ok := c.Conn.(driver.ExecerContext); ok {
		return ec.ExecContext(ctx, c.rewrite(query), args)
	}
	stmt, err := c.PrepareContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	if dargs, err := namedToValue(args); err == nil {
		return stmt.Exec(dargs)
	}
	return nil, errors.New("rewriteConn: cannot exec without ExecerContext")
}

func (c *rewriteConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if qc, ok := c.Conn.(driver.QueryerContext); ok {
		return qc.QueryContext(ctx, c.rewrite(query), args)
	}
	stmt, err := c.PrepareContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	if dargs, err := namedToValue(args); err == nil {
		return stmt.Query(dargs)
	}
	return nil, errors.New("rewriteConn: cannot query without QueryerContext")
}

func namedToValue(args []driver.NamedValue) ([]driver.Value, error) {
	out := make([]driver.Value, len(args))
	for i, a := range args {
		out[i] = a.Value
	}
	return out, nil
}

// rewritePlaceholders converts `?` positional placeholders (outside string
// literals/identifiers) into PostgreSQL $1..$N. Handles single/double quotes
// and escaped quotes.
func rewritePlaceholders(sql string) string {
	var b strings.Builder
	b.Grow(len(sql) + 16)
	inS, inD := false, false
	n := 0
	for i := 0; i < len(sql); i++ {
		ch := sql[i]
		switch {
		case inS:
			b.WriteByte(ch)
			if ch == '\'' {
				if i+1 < len(sql) && sql[i+1] == '\'' {
					b.WriteByte(sql[i+1])
					i++
				} else {
					inS = false
				}
			}
		case inD:
			b.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(sql) && sql[i+1] == '"' {
					b.WriteByte(sql[i+1])
					i++
				} else {
					inD = false
				}
			}
		case ch == '\'':
			inS = true
			b.WriteByte(ch)
		case ch == '"':
			inD = true
			b.WriteByte(ch)
		case ch == '?':
			n++
			fmt.Fprintf(&b, "$%d", n)
		default:
			b.WriteByte(ch)
		}
	}
	return b.String()
}
