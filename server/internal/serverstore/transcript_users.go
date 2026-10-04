package serverstore

import (
	"database/sql"
	"strings"
)

// UsernamesByIDs 批量把 user_id 映射成用户名（需求 §8.2：审计列表要能看到"谁"，
// 而不是只有一串数字）。
//
// 为什么批量而不是逐行查：一页 50 条审计记录若逐条查用户名，就是 50 次往返查询；
// 这里一次 `IN (...)` 取回，缺 id 直接不在返回的 map 里（调用方按空串处理）。
//
// 已删除用户：本函数**不会**为它们编造名字（返回空串）。审计记录按设计要留在库
// 里（0048 哈希链），而用户可能已被抹除 —— 展示层据空串显示"已删除用户"，不要
// 退回去显示裸 user_id：那在运营面上与"系统内部账号"长得一样。
func UsernamesByIDs(db *sql.DB, ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if db == nil || len(ids) == 0 {
		return out, nil
	}
	// 去重：同一页里同一用户可能有多条记录，IN 列表去重后更短。
	seen := make(map[int64]struct{}, len(ids))
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		args = append(args, id)
	}
	if len(args) == 0 {
		return out, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")
	rows, err := db.Query(`SELECT id, username FROM users WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return out, err
		}
		out[id] = name
	}
	return out, rows.Err()
}
