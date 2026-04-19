package com.louisfiges.auth.token;

import com.louisfiges.common.KeyLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.Claims;

import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.util.Set;

public abstract class TokenProvider {
    private static final Logger logger = LoggerFactory.getLogger(TokenProvider.class);
    private static final String DEFAULT_ISSUER = "mdes-secure-voip-auth";
    private static final String PRIVATE_KEY_SETTING = "JWT_PRIVATE_KEY_B64";
    private static final String PUBLIC_KEY_SETTING = "JWT_PUBLIC_KEY_B64";

    private final PrivateKey signingKey;
    private final PublicKey verificationKey;
    private final TokenUse tokenUse;
    private final String issuer;

    public TokenProvider(TokenUse tokenUse) {
        this.signingKey = KeyLoader.loadPrivateKey(PRIVATE_KEY_SETTING);
        this.verificationKey = KeyLoader.loadPublicKey(PUBLIC_KEY_SETTING);
        this.tokenUse = tokenUse;
        this.issuer = loadIssuer();
    }

    protected String generate(UUID id, long expirationTime) {
        return Jwts.builder()
                .subject(String.valueOf(id))
                .issuer(issuer)
                .audience().add(tokenUse.audience()).and()
                .claim("token_use", tokenUse.value())
                .id(UUID.randomUUID().toString())
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationTime))
                .signWith(signingKey, Jwts.SIG.RS256)
                .compact();
    }

    protected String generate(UUID id, String username, long expirationTime) {
        return Jwts.builder()
                .subject(String.valueOf(id))
                .issuer(issuer)
                .audience().add(tokenUse.audience()).and()
                .claim("token_use", tokenUse.value())
                .claim("username", username)
                .id(UUID.randomUUID().toString())
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationTime))
                .signWith(signingKey, Jwts.SIG.RS256)
                .compact();
    }

    public Optional<UUID> validateAndGetUserId(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(verificationKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            if (!issuer.equals(claims.getIssuer())) {
                logger.warn("Token issuer mismatch");
                return Optional.empty();
            }

            if (!tokenUse.value().equals(claims.get("token_use", String.class))) {
                logger.warn("Token use mismatch");
                return Optional.empty();
            }

            Set<String> audiences = claims.getAudience();
            if (audiences == null || !audiences.contains(tokenUse.audience())) {
                logger.warn("Token audience mismatch");
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
                    .verifyWith(verificationKey)
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

    public PrivateKey getSigningKey() {
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

    private static String loadIssuer() {
        String raw = System.getProperty("JWT_ISSUER");
        if (raw == null || raw.isBlank()) {
            raw = System.getenv("JWT_ISSUER");
        }
        return (raw == null || raw.isBlank()) ? DEFAULT_ISSUER : raw.trim();
    }
}
