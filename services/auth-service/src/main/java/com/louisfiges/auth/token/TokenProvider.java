package com.louisfiges.auth.token;

import com.louisfiges.common.KeyLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.Claims;

import javax.crypto.SecretKey;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

public abstract class TokenProvider {
    private static final Logger logger = LoggerFactory.getLogger(TokenProvider.class);

    private final SecretKey signingKey;

    public TokenProvider(String envVarName) {
        this.signingKey = KeyLoader.loadKeyFromEnv(envVarName);
    }

    protected String generate(UUID id, long expirationTime) {
        return Jwts.builder()
                .subject(String.valueOf(id))
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationTime))
                .signWith(signingKey)
                .compact();
    }

    protected String generate(UUID id, String username, long expirationTime) {
        return Jwts.builder()
                .subject(String.valueOf(id))
                .claim("username", username)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationTime))
                .signWith(signingKey)
                .compact();
    }

    public Optional<UUID> validateAndGetUserId(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            if (claims.getExpiration().before(new Date())) {
                logger.debug("Token expired");
                return Optional.empty();
            }

            return Optional.of(UUID.fromString(claims.getSubject()));
        } catch (JwtException e) {
            logger.error("Invalid token: {}", e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<Long> getRemainingExpiry(String token) {
        try {
            Date expiry = Jwts.parser()
                    .verifyWith(signingKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload()
                    .getExpiration();
            long remaining = expiry.getTime() - System.currentTimeMillis();
            return remaining > 0 ? Optional.of(remaining) : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    public SecretKey getSigningKey() {
        return signingKey;
    }

    protected static long getExpirationMsFromEnv(String envVarName, long defaultMs) {
        String raw = System.getenv(envVarName);
        if (raw == null || raw.isBlank()) return defaultMs;
        try {
            long seconds = Long.parseLong(raw.trim());
            if (seconds <= 0) {
                logger.warn("{} must be positive. Falling back to default.", envVarName);
                return defaultMs;
            }
            return seconds * 1000L;
        } catch (NumberFormatException e) {
            logger.warn("Invalid {} value '{}'. Falling back to default.", envVarName, raw);
            return defaultMs;
        }
    }
}