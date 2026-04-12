package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/middleware"
)

func init() {
	_ = middleware.InitAuth
}

func allowedSet(origins ...string) map[string]struct{} {
	m := make(map[string]struct{})
	for _, o := range origins {
		m[o] = struct{}{}
	}
	return m
}

func TestCORS_AllowedOriginSetsHeader(t *testing.T) {
	router := buildRouter(allowedSet("http://allowed.com"))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://allowed.com")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, "http://allowed.com", rr.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "Origin", rr.Header().Get("Vary"))
}

func TestCORS_DisallowedOriginNoHeader(t *testing.T) {
	router := buildRouter(allowedSet("http://allowed.com"))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://evil.com")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Empty(t, rr.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_OPTIONS_Returns204(t *testing.T) {
	router := buildRouter(allowedSet("http://allowed.com"))
	req := httptest.NewRequest(http.MethodOptions, "/health", nil)
	req.Header.Set("Origin", "http://allowed.com")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestCORS_AllowMethodsAndHeadersAlwaysSet(t *testing.T) {
	router := buildRouter(allowedSet("http://allowed.com"))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	// No origin header
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, "GET, POST, PUT, DELETE, OPTIONS",
		rr.Header().Get("Access-Control-Allow-Methods"))
	assert.Equal(t, "Content-Type, Authorization",
		rr.Header().Get("Access-Control-Allow-Headers"))
}

func TestCORS_NonOptionPassesThrough(t *testing.T) {
	router := buildRouter(allowedSet("http://allowed.com"))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "ok", rr.Body.String())
}

func TestCORS_NoOriginHeaderNoACHeader(t *testing.T) {
	router := buildRouter(allowedSet("http://allowed.com"))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Empty(t, rr.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_VaryHeaderSetWhenOriginMatches(t *testing.T) {
	router := buildRouter(allowedSet("http://vary.com"))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://vary.com")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, "Origin", rr.Header().Get("Vary"))
}

func resetRateLimiter() {
	redeemLimitersMu.Lock()
	redeemLimiters = make(map[string]*redeemEntry)
	redeemLimitersMu.Unlock()
}

func callRedeemMiddleware(t *testing.T, ip string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/test", nil)
	req.RemoteAddr = ip + ":12345"
	rr := httptest.NewRecorder()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	redeemRateLimitMiddleware(next).ServeHTTP(rr, req)
	return rr.Code
}

func TestRedeemRateLimit_FirstRequestPasses(t *testing.T) {
	resetRateLimiter()
	assert.Equal(t, http.StatusOK, callRedeemMiddleware(t, "1.2.3.4"))
}

func TestRedeemRateLimit_TenRequestsPass(t *testing.T) {
	resetRateLimiter()
	for i := 0; i < 10; i++ {
		assert.Equal(t, http.StatusOK, callRedeemMiddleware(t, "1.2.3.4"),
			"request %d should pass", i+1)
	}
}

func TestRedeemRateLimit_EleventhRequestRejected(t *testing.T) {
	resetRateLimiter()
	for i := 0; i < 10; i++ {
		callRedeemMiddleware(t, "1.2.3.4")
	}
	assert.Equal(t, http.StatusTooManyRequests, callRedeemMiddleware(t, "1.2.3.4"))
}

func TestRedeemRateLimit_DifferentIPNotAffected(t *testing.T) {
	resetRateLimiter()
	for i := 0; i < 10; i++ {
		callRedeemMiddleware(t, "1.2.3.4")
	}
	assert.Equal(t, http.StatusOK, callRedeemMiddleware(t, "5.6.7.8"))
}

func TestRedeemRateLimit_WindowResetAllowsNewRequests(t *testing.T) {
	resetRateLimiter()
	// Manually seed an entry that has already expired
	redeemLimitersMu.Lock()
	redeemLimiters["9.9.9.9"] = &redeemEntry{
		count:   redeemMaxAttempts + 5,
		resetAt: time.Now().Add(-2 * redeemWindow),
	}
	redeemLimitersMu.Unlock()

	// Should pass because the window has reset
	assert.Equal(t, http.StatusOK, callRedeemMiddleware(t, "9.9.9.9"))
}

func TestRedeemRateLimit_InvalidRemoteAddr(t *testing.T) {
	resetRateLimiter()
	req := httptest.NewRequest(http.MethodPost, "/test", nil)
	req.RemoteAddr = "noport"
	rr := httptest.NewRecorder()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	redeemRateLimitMiddleware(next).ServeHTTP(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestRedeemRateLimit_429ResponseJSON(t *testing.T) {
	resetRateLimiter()
	for i := 0; i < redeemMaxAttempts; i++ {
		callRedeemMiddleware(t, "2.3.4.5")
	}
	req := httptest.NewRequest(http.MethodPost, "/test", nil)
	req.RemoteAddr = "2.3.4.5:12345"
	rr := httptest.NewRecorder()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	redeemRateLimitMiddleware(next).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
	assert.Equal(t, "application/json", rr.Header().Get("Content-Type"))
	var resp map[string]string
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&resp))
	assert.Contains(t, resp["error"], "too many")
}
