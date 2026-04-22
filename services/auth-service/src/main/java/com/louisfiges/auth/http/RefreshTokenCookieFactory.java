package com.louisfiges.auth.http;

import org.springframework.http.ResponseCookie;

public final class RefreshTokenCookieFactory {
    public static final String COOKIE_NAME = "refresh_token";
    private static final long REFRESH_COOKIE_MAX_AGE_SECONDS = 60L * 60L * 24L * 28L;

    private RefreshTokenCookieFactory() {
    }

    public static ResponseCookie build(String refreshToken, boolean secure) {
        return ResponseCookie.from(COOKIE_NAME, refreshToken)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path("/")
                .maxAge(REFRESH_COOKIE_MAX_AGE_SECONDS)
                .build();
    }

    public static ResponseCookie clear(boolean secure) {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build();
    }
}
