package com.louisfiges.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

public final class KeyLoader {

    private static final Logger logger = LoggerFactory.getLogger(KeyLoader.class);

    private KeyLoader() {
    }

    public static PrivateKey loadPrivateKey(String settingName) {
        try {
            byte[] der = decodePem(loadRequiredSetting(settingName), "PRIVATE KEY");
            PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
            logger.info("Private signing key loaded successfully");
            return key;
        } catch (Exception e) {
            logger.error("Error loading private key {}: {}", settingName, e.getMessage(), e);
            throw new IllegalStateException("Error loading private key " + settingName, e);
        }
    }

    public static PublicKey loadPublicKey(String settingName) {
        try {
            byte[] der = decodePem(loadRequiredSetting(settingName), "PUBLIC KEY");
            PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
            logger.info("Public verification key loaded successfully");
            return key;
        } catch (Exception e) {
            logger.error("Error loading public key {}: {}", settingName, e.getMessage(), e);
            throw new IllegalStateException("Error loading public key " + settingName, e);
        }
    }

    public static String loadRequiredSetting(String settingName) {
        String value = System.getProperty(settingName);
        if (value == null || value.isBlank()) {
            value = System.getenv(settingName);
        }
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(settingName + " is not set");
        }
        return value;
    }

    private static byte[] decodePem(String rawValue, String expectedLabel) {
        String pem = rawValue.contains("BEGIN")
                ? rawValue
                : new String(Base64.getDecoder().decode(rawValue), StandardCharsets.UTF_8);

        String beginMarker = "-----BEGIN " + expectedLabel + "-----";
        String endMarker = "-----END " + expectedLabel + "-----";
        if (!pem.contains(beginMarker) || !pem.contains(endMarker)) {
            throw new IllegalStateException("Expected PEM value for " + expectedLabel);
        }

        String base64Body = pem
                .replace(beginMarker, "")
                .replace(endMarker, "")
                .replaceAll("\\s+", "");
        return Base64.getDecoder().decode(base64Body);
    }
}
