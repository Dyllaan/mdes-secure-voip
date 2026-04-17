package com.louisfiges.auth.dto.mfa.response;

import java.util.List;

public record MfaSetupResponse(
        String secret,
        String qrCode,
        List<String> backupCodes,
        String message
) {}