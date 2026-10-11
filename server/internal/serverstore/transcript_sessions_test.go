package serverstore

import "testing"

func TestTranscriptSessionsGroupBeforePagination(t *testing.T) {
	db, cleanup := NewTestDB(t)
	t.Cleanup(cleanup)
	u1, err := CreateUser(db, &User{Username: "session-a", Source: "local", Status: 1})
	if err != nil {
		t.Fatal(err)
	}
	u2, err := CreateUser(db, &User{Username: "session-b", Source: "local", Status: 1})
	if err != nil {
		t.Fatal(err)
	}
	for i, uid := range []int64{u1, u1, u2, u1, u1} {
		sid := "shared-id"
		if i >= 3 {
			sid = ""
		}
		status, code := "complete", 200
		if i == 1 {
			status, code = "incomplete", 502
		}
		_, err = db.Exec(`INSERT INTO llm_transcripts (request_id,user_id,endpoint,model,request_body_enc,session_id,audit_status,status_code,total_tokens) VALUES (?,?,?,?,'',?,?,?,?)`, testRequestID(i), uid, "/v1/chat/completions", "model-a", sid, status, code, 10)
		if err != nil {
			t.Fatal(err)
		}
	}
	page, err := ListLLMTranscriptSessions(db, LLMTranscriptFilter{}, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 4 || len(page.Items) != 2 {
		t.Fatalf("group page = %+v", page)
	}
	page, err = ListLLMTranscriptSessions(db, LLMTranscriptFilter{UserID: u1, SessionID: "shared-id"}, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].RequestCount != 2 || page.Items[0].FailureCount != 1 || page.Items[0].TotalTokens != 20 {
		t.Fatalf("user session = %+v", page)
	}
}

func testRequestID(i int) string { return string(rune('a' + i)) }
