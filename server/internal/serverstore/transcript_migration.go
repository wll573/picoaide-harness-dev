package serverstore

import (
	"database/sql"
	"fmt"
)

const transcriptMigrationChunkBytes = 64 << 10

// MigrateLLMTranscriptPrivacy upgrades rows written by the pre-privacy
// implementation. Those rows used the *_enc columns as plaintext and could
// contain system prompts, tool schemas, and reasoning_content. The operation
// is idempotent: encrypted rows are already on the new path and are skipped.
// It returns the number of transcript rows changed.
func MigrateLLMTranscriptPrivacy(db *sql.DB) (int64, error) {
	if db == nil {
		return 0, nil
	}
	var changed int64
	err := withUsageSearchPath(db, func(tx *sql.Tx) error {
		type transcriptRow struct {
			id          int64
			requestBody string
		}
		rows, err := tx.Query(`SELECT id, request_body_enc FROM llm_transcripts ORDER BY id`)
		if err != nil {
			return err
		}
		var transcripts []transcriptRow
		for rows.Next() {
			var row transcriptRow
			if err := rows.Scan(&row.id, &row.requestBody); err != nil {
				rows.Close()
				return err
			}
			transcripts = append(transcripts, row)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}

		for _, row := range transcripts {
			changedRow := false
			if !transcriptPayloadIsEncrypted(row.requestBody) {
				safeRequest := SanitizeLLMTranscriptRequest([]byte(row.requestBody))
				encrypted, err := encryptTranscriptPayload(safeRequest)
				if err != nil {
					return fmt.Errorf("encrypt legacy transcript request %d: %w", row.id, err)
				}
				if _, err := tx.Exec(`UPDATE llm_transcripts SET request_body_enc=? WHERE id=?`, encrypted, row.id); err != nil {
					return err
				}
				changedRow = true
			}

			chunkRows, err := tx.Query(`SELECT seq, payload_enc FROM llm_transcript_chunks
				WHERE transcript_id=? ORDER BY seq`, row.id)
			if err != nil {
				return err
			}
			type chunk struct {
				seq     int64
				payload string
			}
			var chunks []chunk
			legacyChunks := false
			for chunkRows.Next() {
				var item chunk
				if err := chunkRows.Scan(&item.seq, &item.payload); err != nil {
					chunkRows.Close()
					return err
				}
				if !transcriptPayloadIsEncrypted(item.payload) {
					legacyChunks = true
				}
				chunks = append(chunks, item)
			}
			if err := chunkRows.Err(); err != nil {
				chunkRows.Close()
				return err
			}
			if err := chunkRows.Close(); err != nil {
				return err
			}
			if !legacyChunks {
				if changedRow {
					changed++
				}
				continue
			}

			var response []byte
			for _, item := range chunks {
				plain, err := decryptTranscriptPayload(item.payload)
				if err != nil {
					return fmt.Errorf("decrypt legacy transcript response %d: %w", row.id, err)
				}
				response = append(response, plain...)
			}
			safeResponse := SanitizeLLMTranscriptResponse(response)
			if _, err := tx.Exec(`DELETE FROM llm_transcript_chunks WHERE transcript_id=?`, row.id); err != nil {
				return err
			}
			for seq, offset := int64(0), 0; offset < len(safeResponse); seq++ {
				end := offset + transcriptMigrationChunkBytes
				if end > len(safeResponse) {
					end = len(safeResponse)
				}
				encrypted, err := encryptTranscriptPayload(safeResponse[offset:end])
				if err != nil {
					return fmt.Errorf("encrypt legacy transcript response %d: %w", row.id, err)
				}
				if _, err := tx.Exec(`INSERT INTO llm_transcript_chunks
					(transcript_id, seq, payload_enc, byte_length) VALUES (?, ?, ?, ?)`,
					row.id, seq, encrypted, end-offset); err != nil {
					return err
				}
				offset = end
			}
			changedRow = true
			if changedRow {
				changed++
			}
		}
		return nil
	})
	return changed, err
}
