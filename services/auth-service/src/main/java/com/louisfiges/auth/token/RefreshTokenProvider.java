package com.louisfiges.auth.token;

import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class RefreshTokenProvider extends TokenProvider {

    public RefreshTokenProvider() {
        super(TokenUse.REFRESH);
    }

    public String generateToken(UUID id, String username, long expirationTime) {
        return generate(id, username, expirationTime);
    }
}
