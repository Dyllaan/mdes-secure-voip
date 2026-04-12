package handlers

// ephemeral_test.go is in package handlers (not handlers_test) so it can
// directly access the ephemeralRooms map and ephemeralMu for white-box testing.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resetEphemeral clears the in-memory ephemeral room state before each test.
func resetEphemeral() {
	ephemeralMu.Lock()
	ephemeralRooms = make(map[string]ephemeralRoom)
	ephemeralMu.Unlock()
}

func jsonDecodeBody(rr *httptest.ResponseRecorder, v interface{}) error {
	return json.NewDecoder(rr.Body).Decode(v)
}

// ---- StartEphemeral ----

func TestStartEphemeral_Happy201Created(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		map[string]string{"roomId": "room-abc"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())

	ephemeralMu.RLock()
	room, ok := ephemeralRooms[testHubID]
	ephemeralMu.RUnlock()
	assert.True(t, ok)
	assert.Equal(t, "room-abc", room.RoomID)
}

func TestStartEphemeral_AlreadyActive200(t *testing.T) {
	resetEphemeral()
	ephemeralMu.Lock()
	ephemeralRooms[testHubID] = ephemeralRoom{
		RoomID:    "existing-room",
		CreatedAt: time.Now().Unix(),
		MaxAge:    defaultMaxAge,
	}
	ephemeralMu.Unlock()

	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		map[string]string{"roomId": "new-room"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, jsonDecodeBody(rr, &resp))
	assert.Equal(t, "already_active", resp["status"])

	ephemeralMu.RLock()
	room := ephemeralRooms[testHubID]
	ephemeralMu.RUnlock()
	assert.Equal(t, "existing-room", room.RoomID)
}

func TestStartEphemeral_ExpiredRoomReplaced201(t *testing.T) {
	resetEphemeral()
	ephemeralMu.Lock()
	ephemeralRooms[testHubID] = ephemeralRoom{
		RoomID:    "expired-room",
		CreatedAt: time.Now().Unix() - defaultMaxAge - 1,
		MaxAge:    defaultMaxAge,
	}
	ephemeralMu.Unlock()

	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		map[string]string{"roomId": "new-room"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	ephemeralMu.RLock()
	room := ephemeralRooms[testHubID]
	ephemeralMu.RUnlock()
	assert.Equal(t, "new-room", room.RoomID)
}

func TestStartEphemeral_NotAMember403(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		map[string]string{"roomId": "room"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestStartEphemeral_MissingRoomID400(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	// Empty roomId in JSON body triggers the validation
	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		map[string]string{"roomId": ""},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Room ID is required")
}

func TestStartEphemeral_InvalidJSON400(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRawRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		`{bad json`, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestStartEphemeral_ResponseContainsExpiresAt(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	before := time.Now().Unix()
	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/ephemeral",
		map[string]string{"roomId": "test-room"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	StartEphemeral(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, jsonDecodeBody(rr, &resp))
	expiresAt, ok := resp["expiresAt"].(float64)
	require.True(t, ok)
	assert.GreaterOrEqual(t, int64(expiresAt), before+defaultMaxAge)
}

// ---- GetEphemeral ----

func TestGetEphemeral_ActiveRoom200(t *testing.T) {
	resetEphemeral()
	ephemeralMu.Lock()
	ephemeralRooms[testHubID] = ephemeralRoom{
		RoomID:    "active-room",
		CreatedAt: time.Now().Unix(),
		MaxAge:    defaultMaxAge,
	}
	ephemeralMu.Unlock()

	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetEphemeral(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, jsonDecodeBody(rr, &resp))
	assert.True(t, resp["active"].(bool))
	assert.Equal(t, "active-room", resp["roomId"])
}

func TestGetEphemeral_RoomNotFound200ActiveFalse(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetEphemeral(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, jsonDecodeBody(rr, &resp))
	assert.False(t, resp["active"].(bool))
}

func TestGetEphemeral_ExpiredRoomReturnsFalseAndDeletes(t *testing.T) {
	resetEphemeral()
	ephemeralMu.Lock()
	ephemeralRooms[testHubID] = ephemeralRoom{
		RoomID:    "expired-room",
		CreatedAt: time.Now().Unix() - defaultMaxAge - 1,
		MaxAge:    defaultMaxAge,
	}
	ephemeralMu.Unlock()

	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetEphemeral(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, jsonDecodeBody(rr, &resp))
	assert.False(t, resp["active"].(bool))

	ephemeralMu.RLock()
	_, ok := ephemeralRooms[testHubID]
	ephemeralMu.RUnlock()
	assert.False(t, ok, "expired room should be removed from map")
}

func TestGetEphemeral_NotAMember403(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetEphemeral(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

// ---- EndEphemeral ----

func TestEndEphemeral_Happy204(t *testing.T) {
	resetEphemeral()
	ephemeralMu.Lock()
	ephemeralRooms[testHubID] = ephemeralRoom{RoomID: "room", CreatedAt: time.Now().Unix(), MaxAge: defaultMaxAge}
	ephemeralMu.Unlock()

	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	EndEphemeral(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
	ephemeralMu.RLock()
	_, ok := ephemeralRooms[testHubID]
	ephemeralMu.RUnlock()
	assert.False(t, ok)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestEndEphemeral_NonExistentRoom204Idempotent(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	EndEphemeral(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestEndEphemeral_NotAMember403(t *testing.T) {
	resetEphemeral()
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/ephemeral", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	EndEphemeral(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

// ---- Concurrency ----

func TestEphemeralRooms_ConcurrentAccessNoDataRace(t *testing.T) {
	resetEphemeral()
	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			ephemeralMu.Lock()
			ephemeralRooms[testHubID] = ephemeralRoom{
				RoomID:    "concurrent-room",
				CreatedAt: time.Now().Unix(),
				MaxAge:    defaultMaxAge,
			}
			ephemeralMu.Unlock()

			ephemeralMu.RLock()
			_ = ephemeralRooms[testHubID]
			ephemeralMu.RUnlock()
		}()
	}
	wg.Wait()

	ephemeralMu.RLock()
	_, ok := ephemeralRooms[testHubID]
	ephemeralMu.RUnlock()
	assert.True(t, ok)
}
