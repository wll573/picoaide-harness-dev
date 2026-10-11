package serverstore

import (
	"database/sql"
	"errors"
	"time"
)

type GatewayProviderAPIKey struct {
	ID            int64      `json:"id"`
	ProviderID    int64      `json:"provider_id"`
	APIKeyEnc     string     `json:"-"`
	Label         string     `json:"label"`
	Enabled       bool       `json:"enabled"`
	Priority      int        `json:"priority"`
	CooldownUntil *time.Time `json:"cooldown_until,omitempty"`
	FailureCount  int        `json:"failure_count"`
	LastUsedAt    *time.Time `json:"last_used_at,omitempty"`
	LastErrorAt   *time.Time `json:"last_error_at,omitempty"`
	// 0087（需求 §7.3）：成功率 = SuccessCount / TotalCount。
	// TotalCount == 0 表示**尚无样本**（升级前的老行、或从未用过）—— 展示层据此
	// 显示"暂无数据"，不要显示 0%（"0% 成功率"和"还没用过"是两回事，前者会让
	// 运维去排查一把其实没问题的 Key）。
	SuccessCount    int64 `json:"success_count"`
	TotalCount      int64 `json:"total_count"`
	LastErrorStatus int   `json:"last_error_status"`
	// LastErrorMessage 只存网关产生的固定文案（见 keypool.go 的 keyFailureReason），
	// 不含上游响应体原文。
	LastErrorMessage string `json:"last_error_message"`
}

const providerAPIKeyColumns = `id, provider_id, api_key_enc, label, enabled, priority, cooldown_until, failure_count, last_used_at, last_error_at, success_count, total_count, last_error_status, last_error_message`

func scanGatewayProviderAPIKey(scan interface{ Scan(...any) error }) (*GatewayProviderAPIKey, error) {
	var key GatewayProviderAPIKey
	if err := scan.Scan(&key.ID, &key.ProviderID, &key.APIKeyEnc, &key.Label, &key.Enabled, &key.Priority, &key.CooldownUntil, &key.FailureCount, &key.LastUsedAt, &key.LastErrorAt, &key.SuccessCount, &key.TotalCount, &key.LastErrorStatus, &key.LastErrorMessage); err != nil {
		return nil, err
	}
	return &key, nil
}

// 族内关系（R27）：`gateway_provider_api_keys` 是多 Key 池的密钥表，与父表
// `gateway_providers` 同族 —— shadow 同名表存在时，网关会拿诱饵 Key 发请求（静默改
// 路由、账单记到错账号），没有错误面。本文件所有触碰它的函数都必须走已钉事务。
func ListGatewayProviderAPIKeys(db *sql.DB, providerID int64) ([]GatewayProviderAPIKey, error) {
	var out []GatewayProviderAPIKey
	err := withUsageSearchPathRead(db, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT `+providerAPIKeyColumns+` FROM gateway_provider_api_keys WHERE provider_id = ? ORDER BY priority, id`, providerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			key, err := scanGatewayProviderAPIKey(rows)
			if err != nil {
				return err
			}
			out = append(out, *key)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func GetGatewayProviderAPIKey(db *sql.DB, providerID, keyID int64) (*GatewayProviderAPIKey, error) {
	var key *GatewayProviderAPIKey
	err := withUsageSearchPathRead(db, func(tx *sql.Tx) error {
		k, err := scanGatewayProviderAPIKey(tx.QueryRow(`SELECT `+providerAPIKeyColumns+` FROM gateway_provider_api_keys WHERE provider_id = ? AND id = ?`, providerID, keyID))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		key = k
		return nil
	})
	if err != nil {
		return nil, err
	}
	return key, nil
}

func AddGatewayProviderAPIKey(db *sql.DB, key *GatewayProviderAPIKey) (int64, error) {
	var id int64
	err := withUsageSearchPath(db, func(tx *sql.Tx) error {
		var err error
		id, err = InsertIDTx(tx, `INSERT INTO gateway_provider_api_keys (provider_id, api_key_enc, label, enabled, priority) VALUES (?, ?, ?, ?, ?)`, key.ProviderID, key.APIKeyEnc, key.Label, key.Enabled, key.Priority)
		return err
	})
	if err != nil {
		return 0, err
	}
	key.ID = id
	return id, nil
}

func UpdateGatewayProviderAPIKey(db *sql.DB, key *GatewayProviderAPIKey) error {
	return withUsageSearchPath(db, func(tx *sql.Tx) error {
		return updateKeyOrNotFound(tx,
			`UPDATE gateway_provider_api_keys SET api_key_enc = ?, label = ?, enabled = ?, priority = ?, updated_at = now() WHERE provider_id = ? AND id = ?`,
			key.APIKeyEnc, key.Label, key.Enabled, key.Priority, key.ProviderID, key.ID)
	})
}

func DeleteGatewayProviderAPIKey(db *sql.DB, providerID, keyID int64) error {
	return withUsageSearchPath(db, func(tx *sql.Tx) error {
		return updateKeyOrNotFound(tx,
			`DELETE FROM gateway_provider_api_keys WHERE provider_id = ? AND id = ?`, providerID, keyID)
	})
}

// resetKeyOrNotFound 跑一条"按 provider_id + id 定位"的更新/删除语句，0 行受影响
// 时统一返回 ErrNotFound。五处调用点（update/delete/reset）共用这一份判定。
func updateKeyOrNotFound(tx *sql.Tx, query string, args ...any) error {
	result, err := tx.Exec(query, args...)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ResetGatewayProviderAPIKey 清掉 Key 的**当前故障态**：冷却、连续失败计数、最近错误。
//
// 刻意**不**清 success_count / total_count（0087）：那是累计统计，回答"这把 Key 长期
// 表现如何"。管理员点"重置"表达的是"我处理好了，让它重新参与轮询"，而不是"抹掉它的
// 历史" —— 若连统计一起清，一把长期 40% 成功率的 Key 重置后会显示"暂无数据"，
// 运维就失去了判断它该不该被换掉的依据。
//
// 最近错误（status/message）**要**清：它描述的是刚刚被处置掉的那次故障，留着会让
// 界面一直挂着一条已解决的错误。
func ResetGatewayProviderAPIKey(db *sql.DB, providerID, keyID int64) error {
	return withUsageSearchPath(db, func(tx *sql.Tx) error {
		return updateKeyOrNotFound(tx, `UPDATE gateway_provider_api_keys
			SET cooldown_until = NULL, failure_count = 0, last_error_at = NULL,
			    last_error_status = 0, last_error_message = '', updated_at = now()
			WHERE provider_id = ? AND id = ?`, providerID, keyID)
	})
}
