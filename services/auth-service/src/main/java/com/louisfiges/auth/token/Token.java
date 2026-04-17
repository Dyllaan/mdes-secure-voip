package com.louisfiges.auth.token;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.Claims;
import java.security.Key;
import java.util.Date;

/**
 * OO Implementation of JWS token
 * JWS is JWT But signed
 * based on the JJWT docs: https://github.com/jwtk/jjwt?tab=readme-ov-file#signed-jwts
 * and https://www.baeldung.com/spring-security-sign-jwt-token
 * essentially if we sign the token we can verify its authenticity (is from our API)
 * @author Louis Figes 
 */
public class Token {

    private final String token;
    private final Claims claims;

    public Token(String token, Key signingKey) {
        this.token = token;
        this.claims = Jwts.parserBuilder()
                .setSigningKey(signingKey)
                .build()
                .parseClaimsJws(token)
                .getBody();
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
