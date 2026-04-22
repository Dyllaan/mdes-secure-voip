package com.louisfiges.auth.dto.request;

public record DeleteUserRequest(
        String mfaCode  // TOTP code or backup code
) {}