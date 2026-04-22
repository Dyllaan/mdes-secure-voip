package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/config"
	"hub-service/internal/structs"
)

const testDeviceID = "device-001"

var testDeviceKey = structs.MemberDeviceKey{
	ID:        "devkey-001",
	UserID:    testUserID,
	DeviceID:  testDeviceID,
	HubID:     testHubID,
	PublicKey: testExistingPublicKeyBase64,
	UpdatedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
}

func TestRegisterDeviceKey_Happy201Create(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).
		WillReturnRows(emptyRows(mock, devKeyCols))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO "member_device_keys"`)).
		WithArgs(sqlmock.AnyArg(), testUserID, testDeviceID, testHubID, testValidPublicKeyBase64, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: testValidPublicKeyBase64},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRegisterDeviceKey_Happy200Update(t *testing.T) {
	mock := newMockDB(t)

	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WithArgs(testUserID, testHubID, sqlmock.AnyArg()).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).
		WithArgs(testUserID, testDeviceID, testHubID, sqlmock.AnyArg()).
		WillReturnRows(mock.NewRows(devKeyCols).AddRow(
			testDeviceKey.ID, testDeviceKey.UserID, testDeviceKey.DeviceID,
			testDeviceKey.HubID, testDeviceKey.PublicKey, testDeviceKey.UpdatedAt))
	mock.ExpectExec(`UPDATE "member_device_keys" SET .+`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: testUpdatedPublicKeyBase64},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	t.Logf("Unmet expectations: %v", mock.ExpectationsWereMet())

	if rr.Code != http.StatusOK {
		t.Logf("Response Body: %s", rr.Body.String())
	}
	assert.Equal(t, http.StatusOK, rr.Code)
	var dk structs.MemberDeviceKey
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&dk))
	assert.Equal(t, testUpdatedPublicKeyBase64, dk.PublicKey)
	require.NoError(t, mock.ExpectationsWereMet())
}

// Helper to inject URL vars if your buildRequest doesn't do it perfectly
func addURLVars(r *http.Request, vars map[string]string) *http.Request {
	ctx := chi.NewRouteContext() // Change this to your router's context if not chi
	for k, v := range vars {
		ctx.URLParams.Add(k, v)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, ctx))
}

func TestRegisterDeviceKey_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: "key"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestRegisterDeviceKey_InvalidJSON(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRawRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		`{bad json`, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestRegisterDeviceKey_MissingDeviceID400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: "", PublicKey: "key"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "deviceId is required")
}

func TestRegisterDeviceKey_MissingPublicKey400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: ""},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "publicKey is required")
}

func TestRegisterDeviceKey_DeviceIDTooLong400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{
			DeviceID:  strings.Repeat("d", config.C.MaxDeviceIDLen+1),
			PublicKey: testValidPublicKeyBase64,
		},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "deviceId too long")
}

func TestRegisterDeviceKey_InvalidPublicKeyBase64400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: "not-base64"},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "publicKey must be valid base64")
}

func TestRegisterDeviceKey_DBSaveError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).
		WillReturnRows(mock.NewRows(devKeyCols).AddRow(
			testDeviceKey.ID, testDeviceKey.UserID, testDeviceKey.DeviceID,
			testDeviceKey.HubID, testDeviceKey.PublicKey, testDeviceKey.UpdatedAt))
	mock.ExpectExec(`"member_device_keys"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: testValidPublicKeyBase64},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestRegisterDeviceKey_DBCreateError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).
		WillReturnRows(emptyRows(mock, devKeyCols))
	mock.ExpectExec(`INSERT INTO "member_device_keys"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPut, "/api/hubs/"+testHubID+"/device-key",
		structs.RegisterDeviceKeyRequest{DeviceID: testDeviceID, PublicKey: testValidPublicKeyBase64},
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	RegisterDeviceKey(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestGetDeviceKeys_Happy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).
		WillReturnRows(mock.NewRows(devKeyCols).AddRow(
			testDeviceKey.ID, testDeviceKey.UserID, testDeviceKey.DeviceID,
			testDeviceKey.HubID, testDeviceKey.PublicKey, testDeviceKey.UpdatedAt))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/device-keys", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetDeviceKeys(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var keys []structs.MemberDeviceKey
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&keys))
	assert.Len(t, keys, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetDeviceKeys_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/device-keys", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetDeviceKeys(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestGetDeviceKeys_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/device-keys", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetDeviceKeys(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestGetDeviceKeys_EmptyResult(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "member_device_keys"`).
		WillReturnRows(emptyRows(mock, devKeyCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/device-keys", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetDeviceKeys(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	var keys []structs.MemberDeviceKey
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&keys))
	assert.Empty(t, keys)
}

func makePostKeyBundlesReq(t *testing.T, req structs.PostKeyBundlesRequest) *http.Request {
	t.Helper()
	return buildRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channel-keys/bundles",
		req, map[string]string{"hubID": testHubID}, testUserID)
}

func validBundlePayload() structs.ChannelKeyBundlePayload {
	return structs.ChannelKeyBundlePayload{
		RecipientUserID:    testUserID,
		RecipientDeviceID:  testDeviceID,
		SenderEphemeralPub: testEphemeralPubBase64,
		Ciphertext:         testCiphertextBase64,
		IV:                 testIVBase64,
	}
}

func expectBundleHappyPath(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
}

func TestPostKeyBundles_Happy201CreateAll(t *testing.T) {
	mock := newMockDB(t)
	expectBundleHappyPath(mock)
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_bundles"`).
		WillReturnRows(emptyRows(mock, bundleCols))
	mock.ExpectExec(`INSERT INTO "channel_key_bundles"`).
		WithArgs(sqlmock.AnyArg(), testChanID, testHubID, testUserID, testDeviceID, int32(1),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID:  testChanID,
		KeyVersion: 1,
		Bundles:    []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)

	assert.Equal(t, http.StatusCreated, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Equal(t, float64(1), resp["stored"])
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPostKeyBundles_Happy201UpsertExisting(t *testing.T) {
	mock := newMockDB(t)
	expectBundleHappyPath(mock)
	existingBundle := structs.ChannelKeyBundle{
		ID: "bundle-001", ChannelID: testChanID, HubID: testHubID,
		RecipientUserID: testUserID, RecipientDeviceID: testDeviceID, KeyVersion: 1,
	}
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_bundles"`).
		WillReturnRows(mock.NewRows(bundleCols).AddRow(
			existingBundle.ID, existingBundle.ChannelID, existingBundle.HubID,
			existingBundle.RecipientUserID, existingBundle.RecipientDeviceID,
			existingBundle.KeyVersion, "oldeph", "oldcipher", "oldiv", time.Now()))
	mock.ExpectExec(`UPDATE "channel_key_bundles"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID:  testChanID,
		KeyVersion: 1,
		Bundles:    []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusCreated, rr.Code)
}

func TestPostKeyBundles_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestPostKeyBundles_InvalidJSON(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := buildRawRequest(t, http.MethodPost, "/api/hubs/"+testHubID+"/channel-keys/bundles",
		`{bad json`, map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestPostKeyBundles_MissingChannelID400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: "", KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "channelId is required")
}

func TestPostKeyBundles_KeyVersionZero400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 0,
		Bundles: []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "keyVersion must be >= 1")
}

func TestPostKeyBundles_EmptyBundles400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "must not be empty")
}

func TestPostKeyBundles_TooManyBundles400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	bundles := make([]structs.ChannelKeyBundlePayload, config.C.MaxBundlesPerRequest+1)
	for i := range bundles {
		bundles[i] = validBundlePayload()
	}

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID:  testChanID,
		KeyVersion: 1,
		Bundles:    bundles,
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Too many bundles")
}

func TestPostKeyBundles_ChannelNotInHub404(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(emptyRows(mock, chanCols))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestPostKeyBundles_DBErrorFetchingMembers(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).WillReturnError(errDB)

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestPostKeyBundles_RecipientNotHubMember400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{validBundlePayload()},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Recipient is not a member")
}

func TestPostKeyBundles_BundleMissingField400(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channels"`).
		WillReturnRows(chanRow(mock, testTextChannel))
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))

	badBundle := structs.ChannelKeyBundlePayload{
		RecipientUserID:    "",
		RecipientDeviceID:  testDeviceID,
		SenderEphemeralPub: "eph",
		Ciphertext:         "ciph",
		IV:                 "iv",
	}
	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID: testChanID, KeyVersion: 1,
		Bundles: []structs.ChannelKeyBundlePayload{badBundle},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestPostKeyBundles_InvalidBundleBase64400(t *testing.T) {
	mock := newMockDB(t)
	expectBundleHappyPath(mock)

	badBundle := validBundlePayload()
	badBundle.Ciphertext = "not-base64"

	req := makePostKeyBundlesReq(t, structs.PostKeyBundlesRequest{
		ChannelID:  testChanID,
		KeyVersion: 1,
		Bundles:    []structs.ChannelKeyBundlePayload{badBundle},
	})
	rr := httptest.NewRecorder()
	PostKeyBundles(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assertErrorBody(t, rr, "Bundle ciphertext must be valid base64")
}

func testBundle() structs.ChannelKeyBundle {
	return structs.ChannelKeyBundle{
		ID:                 "bundle-001",
		ChannelID:          testChanID,
		HubID:              testHubID,
		RecipientUserID:    testUserID,
		RecipientDeviceID:  testDeviceID,
		KeyVersion:         1,
		SenderEphemeralPub: "ephpub",
		Ciphertext:         "ciph",
		IV:                 "iv",
		CreatedAt:          time.Now(),
	}
}

func TestGetKeyBundles_Happy200AllChannels(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	b := testBundle()
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_bundles"`).
		WillReturnRows(mock.NewRows(bundleCols).AddRow(
			b.ID, b.ChannelID, b.HubID, b.RecipientUserID, b.RecipientDeviceID,
			b.KeyVersion, b.SenderEphemeralPub, b.Ciphertext, b.IV, b.CreatedAt))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channel-keys/bundles", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetKeyBundles(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var bundles []structs.ChannelKeyBundle
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&bundles))
	assert.Len(t, bundles, 1)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetKeyBundles_FilteredByChannelID(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_bundles"`).
		WillReturnRows(emptyRows(mock, bundleCols))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channel-keys/bundles?channelId="+testChanID, nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetKeyBundles(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGetKeyBundles_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channel-keys/bundles", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetKeyBundles(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestGetKeyBundles_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_bundles"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodGet, "/api/hubs/"+testHubID+"/channel-keys/bundles", nil,
		map[string]string{"hubID": testHubID}, testUserID)
	rr := httptest.NewRecorder()
	GetKeyBundles(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestSetRotationNeeded_Happy200(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(`UPDATE "channel_key_rotation_flags"`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	SetRotationNeeded(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var flag structs.ChannelKeyRotationFlag
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&flag))
	assert.True(t, flag.RotationNeeded)
}

func TestSetRotationNeeded_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	SetRotationNeeded(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestSetRotationNeeded_DBError(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(`"channel_key_rotation_flags"`).WillReturnError(errDB)

	req := buildRequest(t, http.MethodPost,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	SetRotationNeeded(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestGetRotationNeeded_FlagExists(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_rotation_flags"`).
		WillReturnRows(mock.NewRows(rotCols).AddRow(testChanID, true, time.Now()))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	GetRotationNeeded(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var flag structs.ChannelKeyRotationFlag
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&flag))
	assert.True(t, flag.RotationNeeded)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGetRotationNeeded_FlagNotFound200FalseResponse(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectQuery(`SELECT .+ FROM "channel_key_rotation_flags"`).
		WillReturnRows(emptyRows(mock, rotCols))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	GetRotationNeeded(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.False(t, resp["rotationNeeded"].(bool))
}

func TestGetRotationNeeded_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodGet,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	GetRotationNeeded(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestClearRotationNeeded_Happy204(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "channel_key_rotation_flags"`)).
		WithArgs(testChanID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	ClearRotationNeeded(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestClearRotationNeeded_NotAMember403(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(emptyRows(mock, memberCols))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	ClearRotationNeeded(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestClearRotationNeeded_IdempotentWhenNotFound(t *testing.T) {
	mock := newMockDB(t)
	mock.ExpectQuery(`SELECT .+ FROM "members"`).
		WillReturnRows(memberRow(mock, testRegularMember))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "channel_key_rotation_flags"`)).
		WillReturnResult(sqlmock.NewResult(0, 0))

	req := buildRequest(t, http.MethodDelete,
		"/api/hubs/"+testHubID+"/channels/"+testChanID+"/rotation-needed", nil,
		map[string]string{"hubID": testHubID, "channelID": testChanID}, testUserID)
	rr := httptest.NewRecorder()
	ClearRotationNeeded(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)
}
