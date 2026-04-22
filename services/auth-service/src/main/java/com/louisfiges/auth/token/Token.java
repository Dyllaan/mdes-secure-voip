package com.louisfiges.auth.token;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.Claims;

import javax.crypto.SecretKey;
import java.util.Date;

public class Token {

    private final String token;
    private final Claims claims;

    public Token(String token, SecretKey signingKey) {
        this.token = token;
        this.claims = Jwts.parser()
                .verifyWith(signingKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public String getToken() {
        return token;
    }

    public String getUsername() {
        return claims.getSubject();
    }

    public boolean isExpired() {
        return claims.getExpiration().before(new Date());
    }
}