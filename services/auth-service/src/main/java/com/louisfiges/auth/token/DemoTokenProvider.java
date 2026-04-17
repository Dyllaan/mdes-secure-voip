package com.louisfiges.auth.token;

import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class DemoTokenProvider extends TokenProvider {
    private static final long DEFAULT_DEMO_TOKEN_EXP_MS = 1000L * 60 * 15;

    private final long demoTokenExpMs;

    public DemoTokenProvider() {
        super("DEMO_TOKEN_SECRET");
        this.demoTokenExpMs = getExpirationMsFromEnv("DEMO_TOKEN_EXP_SECONDS", DEFAULT_DEMO_TOKEN_EXP_MS);
    }

    public String generateToken(UUID id) {
        return generate(id, demoTokenExpMs);
    }
}
