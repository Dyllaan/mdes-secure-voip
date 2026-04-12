package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/structs"
)

// ---- inviteTTL ----

func TestInviteTTL_Default24h(t *testing.T) {
	t.Setenv("INVITE_TTL_HOURS", "")
	ttl := inviteTTL()
	assert.Equal(t, 24*time.Hour, ttl)
}

func TestInviteTTL_Custom48h(t *testing.T) {
	t.Setenv("INVITE_TTL_HOURS", "48")
	ttl := inviteTTL()
	assert.Equal(t, 48*time.Hour, ttl)
}

func TestInviteTTL_InvalidValueFallsBack(t *testing.T) {
	t.Setenv("INVITE_TTL_HOURS", "abc")
	ttl := inviteTTL()
	assert.Equal(t, 24*time.Hour, ttl)
}

func TestInviteTTL_ZeroValueFallsBack(t *testing.T) {
	t.Setenv("INVITE_TTL_HOURS", "0")
	ttl := inviteTTL()
	assert.Equal(t, 24*time.Hour, ttl)
}

// ---- CreateInvite ----

func TestCreateInvite_Happy201(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(`INSERT INTO "invite_codes"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/invites", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateInvite(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var invite structs.InviteCode
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&invite))
	assert.Len(t, invite.Code, 32, "code should be 16 bytes hex-encoded = 32 chars")
	assert.True(t, invite.ExpiresAt.After(time.Now()), "expiresAt should be in the future")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestCreateInvite_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/invites", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateInvite(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestCreateInvite_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(`INSERT INTO "invite_codes"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/invites", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	CreateInvite(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

// ---- RedeemInvite ----

const testInviteCode = "abcdef1234567890abcdef1234567890"

func inviteCodeRow(mock sqlmock.Sqlmock, code string, hubID string, expired bool) *sqlmock.Rows {
	expiresAt := time.Now().Add(24 * time.Hour)
	if expired {
		expiresAt = time.Now().Add(-time.Hour)
	}
	return mock.NewRows(inviteCols).AddRow(
		"invite-id-001",
		hubID,
		code,
		time.Now().Add(-time.Hour),
		expiresAt,
	)
}

func TestRedeemInvite_Happy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectBegin()
	// FOR UPDATE invite select
	mock.ExpectQuery(`SELECT .+ FROM "invite_codes"`).
		WillReturnRows(inviteCodeRow(mock, testInviteCode, testHubID, false))
	// Check not already member — empty = not a member
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))
	// Create member
	mock.ExpectExec(`INSERT INTO "members"`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// Fetch hub
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	mock.ExpectCommit()

	req := buildRequest(t, http.MethodPost, "/api/invites/"+testInviteCode+"/redeem", nil,
		map[string]string{"code": testInviteCode}, testUserID)
	rr := httptest.NewRecorder()
	RedeemInvite(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.NotNil(t, resp["hub"])
	assert.NotNil(t, resp["member"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRedeemInvite_InvalidCode404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .+ FROM "invite_codes"`).
		WillReturnRows(emptyRows(mock, inviteCols))
	mock.ExpectRollback()

	req := buildRequest(t, http.MethodPost, "/api/invites/badcode/redeem", nil,
		map[string]string{"code": "badcode"}, testUserID)
	rr := httptest.NewRecorder()
	RedeemInvite(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
	assertErrorBody(t, rr, "Invalid invite code")
}

func TestRedeemInvite_ExpiredCode410(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .+ FROM "invite_codes"`).
		WillReturnRows(inviteCodeRow(mock, testInviteCode, testHubID, true))
	mock.ExpectRollback()

	req := buildRequest(t, http.MethodPost, "/api/invites/"+testInviteCode+"/redeem", nil,
		map[string]string{"code": testInviteCode}, testUserID)
	rr := httptest.NewRecorder()
	RedeemInvite(rr, req)
	assert.Equal(t, http.StatusGone, rr.Code)
	assertErrorBody(t, rr, "expired")
}

func TestRedeemInvite_AlreadyMember409(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .+ FROM "invite_codes"`).
		WillReturnRows(inviteCodeRow(mock, testInviteCode, testHubID, false))
	// User IS already a member
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectRollback()

	req := buildRequest(t, http.MethodPost, "/api/invites/"+testInviteCode+"/redeem", nil,
		map[string]string{"code": testInviteCode}, testUserID)
	rr := httptest.NewRecorder()
	RedeemInvite(rr, req)
	assert.Equal(t, http.StatusConflict, rr.Code)
	assertErrorBody(t, rr, "Already a member")
}

func TestRedeemInvite_DBErrorInTransaction(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .+ FROM "invite_codes"`).
		WillReturnRows(inviteCodeRow(mock, testInviteCode, testHubID, false))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))
	mock.ExpectExec(`INSERT INTO "members"`).WillReturnError(errDB)
	mock.ExpectRollback()

	req := buildRequest(t, http.MethodPost, "/api/invites/"+testInviteCode+"/redeem", nil,
		map[string]string{"code": testInviteCode}, testUserID)
	rr := httptest.NewRecorder()
	RedeemInvite(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
