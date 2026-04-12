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

// ---- CreateHub ----

func TestCreateHub_Happy201(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectExec(`INSERT INTO "hubs"`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "members"`).WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs", map[string]string{"name": "My Hub"}, nil, testUserID)
	rr := httptest.NewRecorder()
	CreateHub(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var hub structs.Hub
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&hub))
	assert.Equal(t, "My Hub", hub.Name)
	assert.Equal(t, testUserID, hub.OwnerID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateHub_InvalidJSON(t *testing.T) {
	_ = newMockDB(t)
	req := buildRawRequest(t, http.MethodPost, "/api/hubs", `{invalid`, nil, testUserID)
	rr := httptest.NewRecorder()
	CreateHub(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Invalid request body")
}

func TestCreateHub_EmptyName(t *testing.T) {
	_ = newMockDB(t)
	req := buildRequest(t, http.MethodPost, "/api/hubs", map[string]string{"name": ""}, nil, testUserID)
	rr := httptest.NewRecorder()
	CreateHub(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Hub name is required")
}

func TestCreateHub_DBErrorOnHubInsert(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectExec(`INSERT INTO "hubs"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost, "/api/hubs", map[string]string{"name": "Fail Hub"}, nil, testUserID)
	rr := httptest.NewRecorder()
	CreateHub(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assertErrorBody(t, rr, "Failed to create hub")
}

func TestCreateHub_DBErrorOnMemberInsert(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectExec(`INSERT INTO "hubs"`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO "members"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost, "/api/hubs", map[string]string{"name": "Fail Hub"}, nil, testUserID)
	rr := httptest.NewRecorder()
	CreateHub(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assertErrorBody(t, rr, "Failed to add owner membership")
}

// ---- ListHubs ----

func TestListHubs_Happy200WithHubs(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))

	req := buildRequest(t, http.MethodGet, "/api/hubs", nil, nil, testUserID)
	rr := httptest.NewRecorder()
	ListHubs(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var hubs []structs.Hub
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&hubs))
	assert.Len(t, hubs, 1)
	assert.Equal(t, testHubID, hubs[0].ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListHubs_EmptyNoMemberships(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs", nil, nil, testUserID)
	rr := httptest.NewRecorder()
	ListHubs(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var hubs []structs.Hub
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&hubs))
	assert.Empty(t, hubs)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListHubs_DBErrorOnMembersFetch(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet, "/api/hubs", nil, nil, testUserID)
	rr := httptest.NewRecorder()
	ListHubs(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assertErrorBody(t, rr, "Failed to fetch memberships")
}

func TestListHubs_DBErrorOnHubsFetch(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet, "/api/hubs", nil, nil, testUserID)
	rr := httptest.NewRecorder()
	ListHubs(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assertErrorBody(t, rr, "Failed to fetch hubs")
}

// ---- GetHub ----

func TestGetHub_Happy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetHub(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var hub structs.Hub
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&hub))
	assert.Equal(t, testHubID, hub.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetHub_NotAMember(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetHub(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Not a member")
}

func TestGetHub_HubNotFound(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(emptyRows(mock, hubCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetHub(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

// ---- DeleteHub ----

func TestDeleteHub_Happy204(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	mock.ExpectExec(`DELETE FROM "hubs"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteHub(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDeleteHub_HubNotFound(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(emptyRows(mock, hubCols))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteHub(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestDeleteHub_NotOwner(t *testing.T) {
	mock := newMockDB(t)
	otherHub := structs.Hub{ID: testHubID, Name: "Hub", OwnerID: "other-user", CreatedAt: testHub.CreatedAt}
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(mock.NewRows(hubCols).AddRow(
			otherHub.ID, otherHub.Name, otherHub.OwnerID, otherHub.CreatedAt))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteHub(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Only the owner")
}

func TestDeleteHub_DBDeleteError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	mock.ExpectExec(`DELETE FROM "hubs"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	DeleteHub(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

// ---- BotJoinHub ----

func TestBotJoinHub_Happy201Creates(t *testing.T) {
	t.Setenv("BOT_SECRET", "supersecret")
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))
	mock.ExpectExec(`INSERT INTO "members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/bot-join", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	req.Header.Set("X-Bot-Secret", "supersecret")
	rr := httptest.NewRecorder()
	BotJoinHub(rr, req)
	assert.Equal(t, http.StatusCreated, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBotJoinHub_AlreadyMember200Idempotent(t *testing.T) {
	t.Setenv("BOT_SECRET", "supersecret")
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testBotMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/bot-join", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	req.Header.Set("X-Bot-Secret", "supersecret")
	rr := httptest.NewRecorder()
	BotJoinHub(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBotJoinHub_MissingBotSecret401(t *testing.T) {
	t.Setenv("BOT_SECRET", "supersecret")
	_ = newMockDB(t)
	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/bot-join", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	BotJoinHub(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestBotJoinHub_WrongBotSecret401(t *testing.T) {
	t.Setenv("BOT_SECRET", "supersecret")
	_ = newMockDB(t)
	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/bot-join", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	req.Header.Set("X-Bot-Secret", "wrongsecret")
	rr := httptest.NewRecorder()
	BotJoinHub(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestBotJoinHub_SameLengthWrongContent(t *testing.T) {
	t.Setenv("BOT_SECRET", "exactlytwelve!")
	_ = newMockDB(t)
	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/bot-join", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	req.Header.Set("X-Bot-Secret", "exactlytwelve?") // same length, different content
	rr := httptest.NewRecorder()
	BotJoinHub(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestBotJoinHub_DBCreateError(t *testing.T) {
	t.Setenv("BOT_SECRET", "supersecret")
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))
	mock.ExpectExec(`INSERT INTO "members"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/bot-join", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	req.Header.Set("X-Bot-Secret", "supersecret")
	rr := httptest.NewRecorder()
	BotJoinHub(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
