package middleware

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "userID"
const UsernameKey contextKey = "username"

var jwtPublicKey *rsa.PublicKey
var jwtIssuer string
var jwtAccessAudience string

// InitAuth must be called once at startup to load the JWT verification key.
func InitAuth() {
	jwtIssuer = strings.TrimSpace(os.Getenv("JWT_ISSUER"))
	if jwtIssuer == "" {
		jwtIssuer = "mdes-secure-voip-auth"
	}
	jwtAccessAudience = strings.TrimSpace(os.Getenv("JWT_ACCESS_AUDIENCE"))
	if jwtAccessAudience == "" {
		jwtAccessAudience = "voip-services"
	}

	raw := strings.TrimSpace(os.Getenv("JWT_PUBLIC_KEY_B64"))
	if raw == "" {
		jwtPublicKey = nil
		return
	}

	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(raw)
		if err != nil {
			decoded = []byte(raw)
		}
	}

	block, _ := pem.Decode(decoded)
	if block == nil {
		jwtPublicKey = nil
		return
	}

	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		jwtPublicKey = nil
		return
	}

	rsaKey, ok := parsedKey.(*rsa.PublicKey)
	if !ok {
		jwtPublicKey = nil
		return
	}

	jwtPublicKey = rsaKey
}

// Auth verifies the JWT and adds the user ID to the request context.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeError(w, http.StatusUnauthorized, "Missing authorization header")
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			writeError(w, http.StatusUnauthorized, "Invalid authorization format")
			return
		}

		if jwtPublicKey == nil {
			writeError(w, http.StatusUnauthorized, "Invalid token")
			return
		}

		token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return jwtPublicKey, nil
		}, jwt.WithAudience(jwtAccessAudience), jwt.WithIssuer(jwtIssuer))

		if err != nil || !token.Valid {
			log.Printf("token verification failed: %v", err)
			writeError(w, http.StatusUnauthorized, "Invalid token")
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			writeError(w, http.StatusUnauthorized, "Invalid token claims")
			return
		}

		userID, ok := claims["sub"].(string)
		if !ok || userID == "" {
			writeError(w, http.StatusUnauthorized, "Missing user ID in token")
			return
		}

		tokenUse, ok := claims["token_use"].(string)
		if !ok || tokenUse != "access" {
			writeError(w, http.StatusUnauthorized, "Invalid token")
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)

		if username, ok := claims["username"].(string); ok && username != "" {
			ctx = context.WithValue(ctx, UsernameKey, username)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserID extracts the authenticated user ID from the request context.
func GetUserID(r *http.Request) string {
	userID, _ := r.Context().Value(UserIDKey).(string)
	return userID
}

func GetUsername(r *http.Request) string {
	username, _ := r.Context().Value(UsernameKey).(string)
	return username
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
