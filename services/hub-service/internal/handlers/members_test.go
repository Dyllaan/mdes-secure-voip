package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/structs"
)

func TestInviteMember_Happy201(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "members"`)).
		WithArgs(sqlmock.AnyArg(), testUser2ID, testHubID, string(structs.RoleMember), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		map[string]string{"userId": testUser2ID},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var m structs.Member
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&m))
	assert.Equal(t, testUser2ID, m.UserID)
	assert.Equal(t, structs.RoleMember, m.Role)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestInviteMember_HubNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(emptyRows(mock, hubCols))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		map[string]string{"userId": testUser2ID},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestInviteMember_NotOwner403(t *testing.T) {
	mock := newMockDB(t)
	otherHub := structs.Hub{ID: testHubID, Name: "Hub", OwnerID: "other-user", CreatedAt: testHub.CreatedAt}
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(mock.NewRows(hubCols).AddRow(otherHub.ID, otherHub.Name, otherHub.OwnerID, otherHub.CreatedAt))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		map[string]string{"userId": testUser2ID},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Only the owner")
}

func TestInviteMember_InvalidJSON(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))

	req := buildRawRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		`{bad`, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestInviteMember_EmptyUserID400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		map[string]string{"userId": ""},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "User ID is required")
}

func TestInviteMember_AlreadyMember409(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	existingMember := structs.Member{ID: testMem2ID, UserID: testUser2ID, HubID: testHubID, Role: structs.RoleMember}
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(mock.NewRows(memberCols).AddRow(
			existingMember.ID, existingMember.UserID, existingMember.HubID,
			string(existingMember.Role), existingMember.JoinedAt))

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		map[string]string{"userId": testUser2ID},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)
	assert.Equal(t, http.StatusConflict, rr.Code)
	assertErrorBody(t, rr, "already a member")
}

func TestInviteMember_DBCreateError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "members"`)).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/members",
		map[string]string{"userId": testUser2ID},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	InviteMember(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestKickMember_Happy204WithRotation(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	targetMember := structs.Member{ID: testMem2ID, UserID: testUser2ID, HubID: testHubID, Role: structs.RoleMember}
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(mock.NewRows(memberCols).AddRow(
			targetMember.ID, targetMember.UserID, targetMember.HubID,
			string(targetMember.Role), targetMember.JoinedAt))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "members"`)).
		WithArgs(testMem2ID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectExec(`INSERT INTO "channel_key_rotation_flags"`).
		WithArgs(testChanID, testHubID, true, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/members/"+testMem2ID, nil,
		map[string]string{"hubID": testHubID, "memberID": testMem2ID}, testUserID)
	rr := httptest.NewRecorder()
	KickMember(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestKickMember_HubNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(emptyRows(mock, hubCols))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/members/"+testMem2ID, nil,
		map[string]string{"hubID": testHubID, "memberID": testMem2ID}, testUserID)
	rr := httptest.NewRecorder()
	KickMember(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestKickMember_NotOwner403(t *testing.T) {
	mock := newMockDB(t)
	otherHub := structs.Hub{ID: testHubID, Name: "Hub", OwnerID: "other-user", CreatedAt: testHub.CreatedAt}
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(mock.NewRows(hubCols).AddRow(
			otherHub.ID, otherHub.Name, otherHub.OwnerID, otherHub.CreatedAt))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/members/"+testMem2ID, nil,
		map[string]string{"hubID": testHubID, "memberID": testMem2ID}, testUserID)
	rr := httptest.NewRecorder()
	KickMember(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Only the owner")
}

func TestKickMember_MemberNotFound404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/members/"+testMem2ID, nil,
		map[string]string{"hubID": testHubID, "memberID": testMem2ID}, testUserID)
	rr := httptest.NewRecorder()
	KickMember(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestKickMember_CannotKickOwner403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	ownerTarget := structs.Member{ID: testMem2ID, UserID: testUser2ID, HubID: testHubID, Role: structs.RoleOwner}
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(mock.NewRows(memberCols).AddRow(
			ownerTarget.ID, ownerTarget.UserID, ownerTarget.HubID,
			string(ownerTarget.Role), ownerTarget.JoinedAt))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/members/"+testMem2ID, nil,
		map[string]string{"hubID": testHubID, "memberID": testMem2ID}, testUserID)
	rr := httptest.NewRecorder()
	KickMember(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Cannot kick the owner")
}

func TestKickMember_DBDeleteError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "hubs"`).
		WillReturnRows(hubRow(mock, testHub))
	targetMember := structs.Member{ID: testMem2ID, UserID: testUser2ID, HubID: testHubID, Role: structs.RoleMember}
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(mock.NewRows(memberCols).AddRow(
			targetMember.ID, targetMember.UserID, targetMember.HubID,
			string(targetMember.Role), targetMember.JoinedAt))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "members"`)).WillReturnError(errDB)

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/members/"+testMem2ID, nil,
		map[string]string{"hubID": testHubID, "memberID": testMem2ID}, testUserID)
	rr := httptest.NewRecorder()
	KickMember(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestListMembers_Happy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/members", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListMembers(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var members []structs.Member
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&members))
	assert.Len(t, members, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListMembers_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/members", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListMembers(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestListMembers_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/members", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	ListMembers(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestLeaveHub_Happy204WithRotation(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "members"`)).
		WithArgs(testMemID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectExec(`INSERT INTO "channel_key_rotation_flags"`).
		WithArgs(testChanID, testHubID, true, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/leave", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	LeaveHub(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestLeaveHub_NotAMember404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/leave", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	LeaveHub(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
	assertErrorBody(t, rr, "Not a member")
}

func TestLeaveHub_OwnerCantLeave403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testOwnerMember))

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/leave", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	LeaveHub(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
	assertErrorBody(t, rr, "Owner cannot leave")
}

func TestLeaveHub_DBDeleteError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "members"`)).WillReturnError(errDB)

	req := buildRequest(t, http.MethodDelete, "/api/hubs/"+testHubID+"/leave", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	LeaveHub(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
