package handlers

// shared test utilities for handler tests.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"hub-service/internal/config"
	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

const testJWTSecret = "test-secret-for-unit-tests-32bytes"

// testUserID / testHubID / testChanID are fixed IDs used across tests.
const (
	testUserID  = "user-111"
	testUser2ID = "user-222"
	// testHubID and testChanID must be valid UUIDs (used in ephemeral channel format tests)
	testHubID  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	testChanID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	testMemID  = "cccccccc-cccc-cccc-cccc-cccccccccccc"
	testMem2ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
)

const (
	testUsername                = "owner"
	testValidPublicKeyBase64    = "bmV3a2V5PT0="
	testUpdatedPublicKeyBase64  = "dXBkYXRlZGtleT09"
	testExistingPublicKeyBase64 = "YmFzZTY0cHVia2V5PT0="
	testEphemeralPubBase64      = "ZWhwdWI9PQ=="
	testCiphertextBase64        = "Y2lwaGVydGV4dD09"
	testIVBase64                = "aXY9PQ=="
	testMessageCiphertext       = "ZW5jLWRhdGE="
	testMessageIV               = "aXYtZGF0YQ=="
)

var (
	testHub = structs.Hub{
		ID:        testHubID,
		Name:      "Test Hub",
		OwnerID:   testUserID,
		CreatedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	testOwnerMember = structs.Member{
		ID:       testMemID,
		Username: "owner",
		UserID:   testUserID,
		HubID:    testHubID,
		Role:     structs.RoleOwner,
		JoinedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	testRegularMember = structs.Member{
		ID:       testMemID,
		Username: "regular",
		UserID:   testUserID,
		HubID:    testHubID,
		Role:     structs.RoleMember,
		JoinedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	testAdminMember = structs.Member{
		ID:       testMemID,
		Username: "admin",
		UserID:   testUserID,
		HubID:    testHubID,
		Role:     structs.RoleAdmin,
		JoinedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	testBotMember = structs.Member{
		ID:       testMemID,
		Username: "bot",
		UserID:   testUserID,
		HubID:    testHubID,
		Role:     structs.RoleBot,
		JoinedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	testTextChannel = structs.Channel{
		ID:        testChanID,
		Name:      "general",
		HubID:     testHubID,
		Type:      structs.ChannelTypeText,
		CreatedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	testVoiceChannel = structs.Channel{
		ID:        testChanID,
		Name:      "voice",
		HubID:     testHubID,
		Type:      structs.ChannelTypeVoice,
		CreatedAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
	}
)

// Column name lists for sqlmock rows
var (
	hubCols    = []string{"id", "name", "owner_id", "created_at"}
	memberCols = []string{"id", "username", "user_id", "hub_id", "role", "joined_at"}
	chanCols   = []string{"id", "name", "hub_id", "type", "created_at"}
	msgCols    = []string{"id", "channel_id", "sender_id", "ciphertext", "iv", "key_version", "timestamp"}
	inviteCols = []string{"id", "hub_id", "code", "created_at", "expires_at"}
	devKeyCols = []string{"id", "user_id", "device_id", "hub_id", "public_key", "updated_at"}
	bundleCols = []string{"id", "channel_id", "hub_id", "recipient_user_id", "recipient_device_id",
		"key_version", "sender_ephemeral_pub", "ciphertext", "iv", "created_at"}
	rotCols = []string{"channel_id", "rotation_needed", "rotation_needed_since"}
)

func init() {
	os.Setenv("JWT_SECRET", testJWTSecret)
	middleware.InitAuth()
	config.InitLimits()
}

// newMockDB sets up a GORM DB backed by go-sqlmock and installs it as the global db.DB.
func newMockDB(t *testing.T) sqlmock.Sqlmock {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)

	dialector := postgres.New(postgres.Config{Conn: sqlDB})
	gormDB, err := gorm.Open(dialector, &gorm.Config{
		Logger:                 logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction: true,
	})
	require.NoError(t, err)

	db.DB = gormDB
	t.Cleanup(func() {
		raw, _ := gormDB.DB()
		raw.Close()
	})
	return mock
}

// makeToken creates a signed JWT for the given userID with the given TTL.
func makeToken(t *testing.T, userID string, ttl time.Duration) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(ttl).Unix(),
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWTSecret))
	require.NoError(t, err)
	return tok
}

// buildRequest creates an http.Request with chi URL params and userID injected into context.
func buildRequest(t *testing.T, method, path string, body interface{}, params map[string]string, userID string) *http.Request {
	t.Helper()
	return buildRequestWithUsername(t, method, path, body, params, userID, "")
}

func buildRequestWithUsername(t *testing.T, method, path string, body interface{}, params map[string]string, userID, username string) *http.Request {
	t.Helper()
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		bodyReader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	if userID != "" {
		ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	}
	if username != "" {
		ctx = context.WithValue(ctx, middleware.UsernameKey, username)
	}
	return req.WithContext(ctx)
}

// buildRawRequest creates an http.Request with a raw string body.
func buildRawRequest(t *testing.T, method, path string, rawBody string, params map[string]string, userID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(rawBody))
	req.Header.Set("Content-Type", "application/json")

	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	if userID != "" {
		ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	}
	return req.WithContext(ctx)
}

// hubRow returns sqlmock rows for a single Hub.
func hubRow(mock sqlmock.Sqlmock, h structs.Hub) *sqlmock.Rows {
	return mock.NewRows(hubCols).AddRow(h.ID, h.Name, h.OwnerID, h.CreatedAt)
}

// memberRow returns sqlmock rows for a single Member.
func memberRow(mock sqlmock.Sqlmock, m structs.Member) *sqlmock.Rows {
	return mock.NewRows(memberCols).AddRow(m.ID, m.Username, m.UserID, m.HubID, string(m.Role), m.JoinedAt)
}

// emptyRows returns empty sqlmock rows for the given columns.
func emptyRows(mock sqlmock.Sqlmock, cols []string) *sqlmock.Rows {
	return mock.NewRows(cols)
}

// chanRow returns sqlmock rows for a single Channel.
func chanRow(mock sqlmock.Sqlmock, c structs.Channel) *sqlmock.Rows {
	return mock.NewRows(chanCols).AddRow(c.ID, c.Name, c.HubID, string(c.Type), c.CreatedAt)
}

// assertErrorBody checks that the response body has an "error" field containing the given substring.
func assertErrorBody(t *testing.T, rr *httptest.ResponseRecorder, wantSubstr string) {
	t.Helper()
	var resp structs.ErrorResponse
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Contains(t, resp.Error, wantSubstr)
}

// errDB is a sentinel DB error for use in tests.
var errDB = fmt.Errorf("simulated database error")
