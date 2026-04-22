package com.louisfiges.auth.http;

import org.springframework.http.ResponseCookie;

public final class TrustedDeviceCookieFactory {
    public static final String COOKIE_NAME = "trusted_device";
    private static final int DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS = 30;

    private TrustedDeviceCookieFactory() {
    }

    public static ResponseCookie build(String deviceToken, boolean secure) {
        return ResponseCookie.from(COOKIE_NAME, deviceToken)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path("/")
                .maxAge(resolveMaxAgeSeconds())
                .build();
    }

    private static long resolveMaxAgeSeconds() {
        String raw = System.getenv("TRUSTED_DEVICE_VALIDITY_DAYS");
        if (raw == null || raw.isBlank()) {
            return DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS * 24L * 60L * 60L;
        }

        try {
            int days = Integer.parseInt(raw.trim());
            int safeDays = days > 0 ? days : DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS;
            return safeDays * 24L * 60L * 60L;
        } catch (NumberFormatException ignored) {
            return DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS * 24L * 60L * 60L;
        }
    }
}
