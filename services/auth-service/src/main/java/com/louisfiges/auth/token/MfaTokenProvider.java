package com.louisfiges.auth.token;

import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * TokenProvider is responsible for generating JWT tokens
 * using a signing key provided via configuration.
 * @author Louis Figes
 */

@Component
public class MfaTokenProvider extends TokenProvider {
    private static final long DEFAULT_MFA_TOKEN_EXP_MS = 1000L * 60 * 5; // 5 minutes

    private final long mfaTokenExpMs;

    public MfaTokenProvider() {
        super("TEMP_MFA_SECRET_KEY");
        this.mfaTokenExpMs = getExpirationMsFromEnv("MFA_TOKEN_EXP_SECONDS", DEFAULT_MFA_TOKEN_EXP_MS);
    }

    public String generateToken(UUID id) {
        return generate(id, mfaTokenExpMs);
    }

}
