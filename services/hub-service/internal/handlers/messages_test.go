package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/config"
	"hub-service/internal/structs"
)

func TestSendMessage_Happy201(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "messages"`)).
		WithArgs(sqlmock.AnyArg(), testChanID, testUserID, testMessageCiphertext, testMessageIV, "v1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	body := map[string]string{
		"ciphertext": testMessageCiphertext,
		"iv":         testMessageIV,
		"keyVersion": "v1",
	}
	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		body,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var msg structs.Message
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&msg))
	assert.Equal(t, testMessageCiphertext, msg.Ciphertext)
	assert.Equal(t, testUserID, msg.SenderID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": "x", "iv": "y", "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestSendMessage_ChannelNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": "x", "iv": "y", "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestSendMessage_InvalidJSON(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRawRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		`{bad json`,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSendMessage_MissingCiphertext(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"iv": "y", "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "required")
}

func TestSendMessage_MissingIV(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": "x", "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSendMessage_MissingKeyVersion(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": "x", "iv": "y"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSendMessage_AllFieldsEmptyString(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": "", "iv": "", "keyVersion": ""},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSendMessage_CiphertextTooLong(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{
			"ciphertext": strings.Repeat("a", config.C.MaxCiphertextLen+1),
			"iv":         testMessageIV,
			"keyVersion": "v1",
		},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Ciphertext too long")
}

func TestSendMessage_InvalidCiphertextBase64400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": "enc-data", "iv": testMessageIV, "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Ciphertext must be valid base64")
}

func TestSendMessage_InvalidIVBase64400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": testMessageCiphertext, "iv": "iv-data", "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "IV must be valid base64")
}

func TestSendMessage_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "messages"`)).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages",
		map[string]string{"ciphertext": testMessageCiphertext, "iv": testMessageIV, "keyVersion": "v1"},
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	SendMessage(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func msgRows(mock sqlmock.Sqlmock, count int) *sqlmock.Rows {
	rows := mock.NewRows(msgCols)
	for i := 0; i < count; i++ {
		rows.AddRow(
			fmt.Sprintf("msg-%d", i),
			testChanID,
			testUserID,
			"ciphertext",
			"iv",
			"v1",
			time.Now().Add(time.Duration(-i)*time.Minute),
		)
	}
	return rows
}

func TestGetMessages_DefaultLimit(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 3))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp structs.MessageHistoryResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Len(t, resp.Messages, 3)
	assert.False(t, resp.HasMore)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetMessages_WithLimit10HasMore(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	// Return 11 rows (limit+1) to signal hasMore
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 11))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages?limit=10", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp structs.MessageHistoryResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Len(t, resp.Messages, 10)
	assert.True(t, resp.HasMore)
}

func TestGetMessages_LimitAtBoundary100(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 0))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages?limit=100", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGetMessages_LimitAboveMaxFallsToDefault(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 0))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages?limit=101", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGetMessages_LimitZeroFallsToDefault(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 0))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages?limit=0", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGetMessages_WithBeforeCursor(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 2))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages?before=2025-06-01T00:00:00Z", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGetMessages_InvalidBeforeParamIgnored(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(msgRows(mock, 0))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages?before=notadate", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	// Invalid before is silently ignored
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGetMessages_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestGetMessages_ChannelNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestGetMessages_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestGetMessages_EmptyChannel(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).
		WillReturnRows(emptyRows(mock, msgCols))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	var resp structs.MessageHistoryResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Empty(t, resp.Messages)
	assert.False(t, resp.HasMore)
}

func TestGetMessages_ChronologicalOrder(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	t1 := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2025, 1, 1, 11, 0, 0, 0, time.UTC)
	// GORM fetches DESC, so mock returns newer first
	rows := mock.NewRows(msgCols).
		AddRow("msg-2", testChanID, testUserID, "c2", "iv", "v1", t2).
		AddRow("msg-1", testChanID, testUserID, "c1", "iv", "v1", t1)
	mock.ExpectQuery(`SELECT .+ FROM "messages"`).WillReturnRows(rows)

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/messages", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID},
		testUserID)
	rr := httptest.NewRecorder()
	GetMessages(rr, req)

	var resp structs.MessageHistoryResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	require.Len(t, resp.Messages, 2)
	// After reversing, msg-1 (older) should be first
	assert.Equal(t, "msg-1", resp.Messages[0].ID)
	assert.Equal(t, "msg-2", resp.Messages[1].ID)
}
