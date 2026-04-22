package middleware_test

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/middleware"
)

func makeSignedToken(t *testing.T, privateKey *rsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	tok, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(privateKey)
	require.NoError(t, err)
	return tok
}

func initWithPublicKey(t *testing.T, publicKeyPEM string) {
	t.Helper()
	t.Setenv("JWT_PUBLIC_KEY_B64", base64.StdEncoding.EncodeToString([]byte(publicKeyPEM)))
	t.Setenv("JWT_ISSUER", "mdes-secure-voip-auth")
	t.Setenv("JWT_ACCESS_AUDIENCE", "voip-services")
	middleware.InitAuth()
}

func generateKeyPair(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	require.NoError(t, err)
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})
	return privateKey, string(publicPEM)
}

func validClaims(userID string, exp time.Time) jwt.MapClaims {
	return jwt.MapClaims{
		"sub":       userID,
		"exp":       exp.Unix(),
		"iss":       "mdes-secure-voip-auth",
		"aud":       "voip-services",
		"token_use": "access",
	}
}

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

func TestInitAuth_ValidPublicKey(t *testing.T) {
	privateKey, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	tok := makeSignedToken(t, privateKey, validClaims("u1", time.Now().Add(time.Hour)))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestInitAuth_EmptyKey(t *testing.T) {
	t.Setenv("JWT_PUBLIC_KEY_B64", "")
	middleware.InitAuth()
	rr := callAuth(t, "token")
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_MissingAuthorizationHeader(t *testing.T) {
	_, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_InvalidFormat_NoBearerPrefix(t *testing.T) {
	_, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Token abc123")
	rr := httptest.NewRecorder()
	middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_InvalidSignature(t *testing.T) {
	privateKey, _ := generateKeyPair(t)
	_, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	tok := makeSignedToken(t, privateKey, validClaims("u1", time.Now().Add(time.Hour)))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_ExpiredToken(t *testing.T) {
	privateKey, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	tok := makeSignedToken(t, privateKey, validClaims("u1", time.Now().Add(-time.Hour)))
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_WrongSigningMethod(t *testing.T) {
	_, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	claims := validClaims("u1", time.Now().Add(time.Hour))
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("wrong-secret"))
	require.NoError(t, err)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_RejectsRefreshTokens(t *testing.T) {
	privateKey, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	claims := validClaims("u1", time.Now().Add(time.Hour))
	claims["token_use"] = "refresh"
	claims["aud"] = "auth-service"
	tok := makeSignedToken(t, privateKey, claims)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_MissingSubClaim(t *testing.T) {
	privateKey, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	claims := validClaims("u1", time.Now().Add(time.Hour))
	delete(claims, "sub")
	tok := makeSignedToken(t, privateKey, claims)
	rr := callAuth(t, tok)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_ValidToken_CallsNext_AndContextPopulated(t *testing.T) {
	privateKey, publicKeyPEM := generateKeyPair(t)
	initWithPublicKey(t, publicKeyPEM)
	var capturedUserID string
	var capturedUsername string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = middleware.GetUserID(r)
		capturedUsername = middleware.GetUsername(r)
		w.WriteHeader(http.StatusOK)
	})
	handler := middleware.Auth(next)

	claims := validClaims("user-abc", time.Now().Add(time.Hour))
	claims["username"] = "alice"
	tok := makeSignedToken(t, privateKey, claims)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "user-abc", capturedUserID)
	assert.Equal(t, "alice", capturedUsername)
}

func TestGetUserID_WithoutValue(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	id := middleware.GetUserID(req)
	assert.Equal(t, "", id)
}
