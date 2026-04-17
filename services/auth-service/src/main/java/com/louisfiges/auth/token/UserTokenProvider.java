package com.louisfiges.auth.token;

import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * TokenProvider is responsible for generating JWT tokens
 * using a signing key provided via configuration.
 * @author Louis Figes
 */

@Component
public class UserTokenProvider extends TokenProvider {
    private static final long DEFAULT_ACCESS_TOKEN_EXP_MS = 1000L * 60 * 15; // 15 minutes
    private static final long DEFAULT_REFRESH_TOKEN_EXP_MS = 1000L * 60 * 60 * 24 * 28; // 28 days

    private final long accessTokenExpMs;
    private final long refreshTokenExpMs;

    public UserTokenProvider() {
        super("SECRET_KEY");
        this.accessTokenExpMs = getExpirationMsFromEnv("ACCESS_TOKEN_EXP_SECONDS", DEFAULT_ACCESS_TOKEN_EXP_MS);
        this.refreshTokenExpMs = getExpirationMsFromEnv("REFRESH_TOKEN_EXP_SECONDS", DEFAULT_REFRESH_TOKEN_EXP_MS);
    }

    public String generateAccessToken(UUID id, String username) {
        return generate(id, username, accessTokenExpMs);
    }

    public String generateRefreshToken(UUID id, String username) {
        return generate(id, username, refreshTokenExpMs);
    }
}
