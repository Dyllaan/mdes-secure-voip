package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/structs"
)

// ---- CreateChannel ----

func TestCreateChannel_Happy201TextDefault(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	// Channel uniqueness check — not found (good)
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))
	mock.ExpectExec(`INSERT INTO "channels"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "general"}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var ch structs.Channel
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&ch))
	assert.Equal(t, "general", ch.Name)
	assert.Equal(t, structs.ChannelTypeText, ch.Type)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateChannel_Happy201VoiceExplicit(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))
	mock.ExpectExec(`INSERT INTO "channels"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]interface{}{"name": "voice-room", "type": "voice"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var ch structs.Channel
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&ch))
	assert.Equal(t, structs.ChannelTypeVoice, ch.Type)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateChannel_Happy201AdminRole(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testAdminMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))
	mock.ExpectExec(`INSERT INTO "channels"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "admin-chan"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusCreated, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateChannel_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "chan"}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Not a member")
}

func TestCreateChannel_MemberRole403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "chan"}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Only owners and admins")
}

func TestCreateChannel_BotRole403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testBotMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "chan"}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestCreateChannel_InvalidJSON(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))

	req := buildRawRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		`{bad json`, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestCreateChannel_EmptyName(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": ""}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Channel name is required")
}

func TestCreateChannel_InvalidType(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]interface{}{"name": "chan", "type": "audio"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, `"text" or "voice"`)
}

func TestCreateChannel_DuplicateName409(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	// Channel exists
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "general"}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusConflict, rr.Code)
	assertErrorBody(t, rr, "already exists")
}

func TestCreateChannel_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))
	mock.ExpectExec(`INSERT INTO "channels"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channels",
		map[string]string{"name": "chan"}, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateChannel(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

// ---- ListChannels ----

func TestListChannels_Happy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channels", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListChannels(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var chans []structs.Channel
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&chans))
	assert.Len(t, chans, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListChannels_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channels", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListChannels(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestListChannels_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channels", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListChannels(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestListChannels_EmptyList(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channels", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListChannels(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	var chans []structs.Channel
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&chans))
	assert.Empty(t, chans)
}

// ---- DeleteChannel ----

func TestDeleteChannel_Happy204(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectExec(`DELETE FROM "channels"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID, nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteChannel(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteChannel_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID, nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteChannel(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestDeleteChannel_MemberRole403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID, nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteChannel(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Only owners and admins")
}

func TestDeleteChannel_ChannelNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID, nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteChannel(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestDeleteChannel_DBDeleteError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectExec(`DELETE FROM "channels"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID, nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteChannel(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

// ---- CheckChannelAccess ----

func TestCheckChannelAccess_EphemeralHappyPath(t *testing.T) {
	mock := newMockDB(t)
	ephChanID := "ephemeral-" + testHubID
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodGet, "/api/channels/"+ephChanID+"/access", nil,
		map[string]string{"channelID": ephChanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]string
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, testUserID, resp["userID"])
	assert.Equal(t, ephChanID, resp["channelID"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckChannelAccess_EphemeralInvalidFormatPathTraversal(t *testing.T) {
	_ = newMockDB(t)
	chanID := "ephemeral-../../etc/passwd"
	req := buildRequest(t, http.MethodGet, "/api/channels/"+chanID+"/access", nil,
		map[string]string{"channelID": chanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Invalid ephemeral channel ID format")
}

func TestCheckChannelAccess_EphemeralInvalidFormatShortUUID(t *testing.T) {
	_ = newMockDB(t)
	chanID := "ephemeral-abc123"
	req := buildRequest(t, http.MethodGet, "/api/channels/"+chanID+"/access", nil,
		map[string]string{"channelID": chanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestCheckChannelAccess_EphemeralNotMember403(t *testing.T) {
	mock := newMockDB(t)
	ephChanID := "ephemeral-" + testHubID
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/channels/"+ephChanID+"/access", nil,
		map[string]string{"channelID": ephChanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestCheckChannelAccess_VoiceChannelHappy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testVoiceChannel))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodGet, "/api/channels/"+testChanID+"/access", nil,
		map[string]string{"channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]string
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, testChanID, resp["channelID"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCheckChannelAccess_ChannelNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))

	req := buildRequest(t, http.MethodGet, "/api/channels/"+testChanID+"/access", nil,
		map[string]string{"channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestCheckChannelAccess_TextChannel403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))

	req := buildRequest(t, http.MethodGet, "/api/channels/"+testChanID+"/access", nil,
		map[string]string{"channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "not a voice channel")
}

func TestCheckChannelAccess_VoiceChannelNotMemberOfHub403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testVoiceChannel))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/channels/"+testChanID+"/access", nil,
		map[string]string{"channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	CheckChannelAccess(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}
