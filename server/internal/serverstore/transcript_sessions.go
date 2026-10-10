package serverstore

import (
	"database/sql"
	"time"
)

// LLMTranscriptSession summarizes one user's conversation. Missing session IDs
// remain separate requests, so unrelated legacy records never become one session.
type LLMTranscriptSession struct {
	UserID       int64     `json:"user_id"`
	SessionID    string    `json:"session_id"`
	TranscriptID int64     `json:"transcript_id"`
	RequestCount int64     `json:"request_count"`
	FailureCount int64     `json:"failure_count"`
	PendingCount int64     `json:"pending_count"`
	TotalTokens  int64     `json:"total_tokens"`
	Models       string    `json:"models"`
	CreatedAt    time.Time `json:"created_at"`
	LastAt       time.Time `json:"last_at"`
}

type LLMTranscriptSessionPage struct {
	Items []LLMTranscriptSession
	Total int64
}

func ListLLMTranscriptSessions(db *sql.DB, filter LLMTranscriptFilter, offset, limit int64) (LLMTranscriptSessionPage, error) {
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	where, args := transcriptFilterWhere(filter)
	grouped := ` FROM llm_transcripts` + where + ` GROUP BY user_id, session_id, CASE WHEN session_id='' THEN id ELSE 0 END`
	page := LLMTranscriptSessionPage{Items: []LLMTranscriptSession{}}
	err := withUsageSearchPathRead(db, func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT COUNT(*) FROM (SELECT 1`+grouped+`) AS sessions`, args...).Scan(&page.Total); err != nil {
			return err
		}
		params := append(append([]any{}, args...), limit, offset)
		rows, err := tx.Query(`SELECT user_id,session_id,MIN(id),COUNT(*),
			COUNT(*) FILTER (WHERE audit_status IN ('incomplete','write_failed') OR status_code>=400),
			COUNT(*) FILTER (WHERE audit_status='pending'),SUM(total_tokens),
			string_agg(DISTINCT model, ', ' ORDER BY model),MIN(created_at),MAX(created_at)`+grouped+
			` ORDER BY MAX(created_at) DESC, MAX(id) DESC LIMIT ? OFFSET ?`, params...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var row LLMTranscriptSession
			if err := rows.Scan(&row.UserID, &row.SessionID, &row.TranscriptID, &row.RequestCount, &row.FailureCount, &row.PendingCount, &row.TotalTokens, &row.Models, &row.CreatedAt, &row.LastAt); err != nil {
				return err
			}
			page.Items = append(page.Items, row)
		}
		return rows.Err()
	})
	return page, err
}
