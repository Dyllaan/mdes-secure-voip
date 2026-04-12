package middleware_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/middleware"
)

// plainSecret must contain characters outside the base64url alphabet (e.g. '!', '@')
// so that both URLEncoding and RawURLEncoding fail, and InitAuth falls back to
// using the raw string directly as the HMAC secret.
const plainSecret = "super!secret@plain#2025"

func makeSignedToken(t *testing.T, secret []byte, userID string, exp time.Time) string {
	t.Helper()
	claims := jwt.MapClaims{"sub": userID, "exp": exp.Unix()}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	require.NoError(t, err)
	return tok
}

func initWithSecret(t *testing.T, secret string) {
	t.Helper()
	t.Setenv("JWT_SECRET", secret)
	middleware.InitAuth()
}

func TestInitAuth_PlainText(t *testing.T) {
	initWithSecret(t, plainSecret)
	// Verify a token signed with the plain secret is accepted
	tok := makeSignedToken(t, []byte(plainSecret), "u1", time.Now().Add(time.Hour))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestInitAuth_Base64URLEncoded(t *testing.T) {
	encoded := base64.URLEncoding.EncodeToString([]byte(plainSecret))
	initWithSecret(t, encoded)
	tok := makeSignedToken(t, []byte(plainSecret), "u1", time.Now().Add(time.Hour))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestInitAuth_RawBase64URLEncoded(t *testing.T) {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(plainSecret))
	// Make sure standard URL encoding fails for this (no padding)
	_, err := base64.URLEncoding.DecodeString(encoded)
	// If err is nil the standard encoding also succeeds (acceptable), test still valid
	_ = err
	initWithSecret(t, encoded)
	tok := makeSignedToken(t, []byte(plainSecret), "u1", time.Now().Add(time.Hour))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestInitAuth_EmptySecret(t *testing.T) {
	initWithSecret(t, "")
	// Any token with an empty secret should fail (signature mismatch)
	tok := makeSignedToken(t, []byte("something"), "u1", time.Now().Add(time.Hour))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

// callAuth runs the Auth middleware around a simple 200 handler and returns the recorder.
func callAuth(t *testing.T, authHeader string) *httptest.ResponseRecorder {
	t.Helper()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := middleware.Auth(next)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", "Bearer "+authHeader)
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func TestAuth_MissingAuthorizationHeader(t *testing.T) {
	initWithSecret(t, plainSecret)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_InvalidFormat_NoBearerPrefix(t *testing.T) {
	initWithSecret(t, plainSecret)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Token abc123")
	rr := httptest.NewRecorder()
	middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_InvalidFormat_NoSpace(t *testing.T) {
	initWithSecret(t, plainSecret)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearertoken")
	rr := httptest.NewRecorder()
	middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_InvalidSignature(t *testing.T) {
	initWithSecret(t, plainSecret)
	tok := makeSignedToken(t, []byte("wrong-secret"), "u1", time.Now().Add(time.Hour))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_ExpiredToken(t *testing.T) {
	initWithSecret(t, plainSecret)
	tok := makeSignedToken(t, []byte(plainSecret), "u1", time.Now().Add(-time.Hour))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_WrongSigningMethod(t *testing.T) {
	initWithSecret(t, plainSecret)
	// Generate an RSA key and sign with RS256
	rsaKey, err := generateRSAKey()
	if err != nil {
		t.Skip("could not generate RSA key:", err)
	}
	claims := jwt.MapClaims{"sub": "u1", "exp": time.Now().Add(time.Hour).Unix()}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(rsaKey)
	require.NoError(t, err)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_MissingSubClaim(t *testing.T) {
	initWithSecret(t, plainSecret)
	claims := jwt.MapClaims{"exp": time.Now().Add(time.Hour).Unix()} // no "sub"
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(plainSecret))
	require.NoError(t, err)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_EmptySubClaim(t *testing.T) {
	initWithSecret(t, plainSecret)
	claims := jwt.MapClaims{"sub": "", "exp": time.Now().Add(time.Hour).Unix()}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(plainSecret))
	require.NoError(t, err)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_NumericSubClaim(t *testing.T) {
	initWithSecret(t, plainSecret)
	claims := jwt.MapClaims{"sub": float64(12345), "exp": time.Now().Add(time.Hour).Unix()}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(plainSecret))
	require.NoError(t, err)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_ValidToken_CallsNext_AndContextPopulated(t *testing.T) {
	initWithSecret(t, plainSecret)
	var capturedUserID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = middleware.GetUserID(r)
		w.WriteHeader(http.StatusOK)
	})
	handler := middleware.Auth(next)

	tok := makeSignedToken(t, []byte(plainSecret), "user-abc", time.Now().Add(time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "user-abc", capturedUserID)
}

func TestGetUserID_WithValue(t *testing.T) {
	initWithSecret(t, plainSecret)
	var capturedID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedID = middleware.GetUserID(r)
		w.WriteHeader(http.StatusOK)
	})
	tok := makeSignedToken(t, []byte(plainSecret), "uid-xyz", time.Now().Add(time.Hour))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	middleware.Auth(next).ServeHTTP(rr, req)
	assert.Equal(t, "uid-xyz", capturedID)
}

func TestGetUserID_WithoutValue(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	id := middleware.GetUserID(req)
	assert.Equal(t, "", id)
}

// generateRSAKey generates an RSA private key for testing the wrong-signing-method case.
func generateRSAKey() (*rsa.PrivateKey, error) {
	return rsa.GenerateKey(rand.Reader, 2048)
}
