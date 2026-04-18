package com.louisfiges.common;

import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.crypto.SecretKey;
import java.util.Base64;

public class KeyLoader {

    private static final Logger logger = LoggerFactory.getLogger(KeyLoader.class);

    public static SecretKey loadKeyFromEnv(String envVarName) {
        try {
            String secret = System.getenv(envVarName);
            if (secret == null || secret.isEmpty()) {
                throw new IllegalStateException(envVarName + " is not set in environment or .env file");
            }
            byte[] decodedKey = Base64.getDecoder().decode(secret);
            logger.info("Secret key loaded successfully");
            return Keys.hmacShaKeyFor(decodedKey);
        } catch (Exception e) {
            logger.error("Error loading secret key from env: {}", e.getMessage(), e);
            throw new IllegalStateException("Error loading secret key from env", e);
        }
    }
}