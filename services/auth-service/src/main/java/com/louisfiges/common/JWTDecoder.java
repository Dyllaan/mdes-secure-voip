package com.louisfiges.common;

import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.context.annotation.Bean;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

public abstract class JWTDecoder {
    @Bean
    public org.springframework.security.oauth2.jwt.JwtDecoder jwtDecoder() {
        try {
            String secret = System.getenv("SECRET_KEY");
            System.out.println("SECRET_KEY loaded: " + (secret != null ? "yes, length=" + secret.length() : "NO"));

            if (secret == null || secret.isEmpty()) {
                throw new IllegalStateException("SECRET_KEY is not set in the .env file");
            }
            byte[] decodedKey = Base64.getDecoder().decode(secret);
            SecretKey secretKey = new SecretKeySpec(decodedKey, "HmacSHA256");
            return NimbusJwtDecoder.withSecretKey(secretKey).build();
        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Failed to create JwtDecoder", e);
        }
    }
}
