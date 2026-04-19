package com.louisfiges.common;

import org.springframework.context.annotation.Bean;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.security.PublicKey;
import java.security.interfaces.RSAPublicKey;

public abstract class JWTDecoder {
    @Bean
    public org.springframework.security.oauth2.jwt.JwtDecoder jwtDecoder() {
        PublicKey publicKey = KeyLoader.loadPublicKey("JWT_PUBLIC_KEY_B64");
        if (!(publicKey instanceof RSAPublicKey rsaPublicKey)) {
            throw new IllegalStateException("JWT public key must be an RSA public key");
        }
        return NimbusJwtDecoder.withPublicKey(rsaPublicKey).build();
    }
}
