package serverstore

import (
	"database/sql"
	"fmt"
)

const transcriptMigrationChunkBytes = 64 << 10

// MigrateLLMTranscriptPrivacy upgrades rows onto the plain audit path.
//
// Boss decision (plain): audit bodies are stored as plaintext. This migration:
//   - sanitizes legacy plaintext that still contains system/tools/reasoning;
//   - decrypts enc:v1: rows when possible, sanitizes, and rewrites as plaintext;
//   - leaves undecryptable ciphertext unchanged (no data loss; read path marks damaged).
//
// It is idempotent: already-plain sanitized rows are skipped. Returns the number
// of transcript rows changed.
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

			requestPlain, requestOK, _ := decodeTranscriptPayload(row.requestBody)
			if requestOK {
				safeRequest := SanitizeLLMTranscriptRequest(requestPlain)
				stored := storeTranscriptPayload(safeRequest)
				// Rewrite when still encrypted, or when sanitization changed content.
				if transcriptPayloadIsEncrypted(row.requestBody) || stored != row.requestBody {
					if _, err := tx.Exec(`UPDATE llm_transcripts SET request_body_enc=? WHERE id=?`, stored, row.id); err != nil {
						return err
					}
					changedRow = true
				}
			}
			// If request ciphertext cannot be opened, leave it untouched.

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
			needsRewrite := false
			allDecodable := true
			for chunkRows.Next() {
				var item chunk
				if err := chunkRows.Scan(&item.seq, &item.payload); err != nil {
					chunkRows.Close()
					return err
				}
				if transcriptPayloadIsEncrypted(item.payload) {
					needsRewrite = true
				}
				if _, ok, _ := decodeTranscriptPayload(item.payload); !ok {
					allDecodable = false
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

			if len(chunks) == 0 {
				if changedRow {
					changed++
				}
				continue
			}

			// Undecryptable chunks: leave as-is (no data loss).
			if !allDecodable {
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

			// Rewrite when any chunk was encrypted, or sanitization changed the body.
			original := string(response)
			if !needsRewrite && string(safeResponse) == original {
				if changedRow {
					changed++
				}
				continue
			}

			if _, err := tx.Exec(`DELETE FROM llm_transcript_chunks WHERE transcript_id=?`, row.id); err != nil {
				return err
			}
			for seq, offset := int64(0), 0; offset < len(safeResponse); seq++ {
				end := offset + transcriptMigrationChunkBytes
				if end > len(safeResponse) {
					end = len(safeResponse)
				}
				stored := storeTranscriptPayload(safeResponse[offset:end])
				if _, err := tx.Exec(`INSERT INTO llm_transcript_chunks
					(transcript_id, seq, payload_enc, byte_length) VALUES (?, ?, ?, ?)`,
					row.id, seq, stored, end-offset); err != nil {
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
