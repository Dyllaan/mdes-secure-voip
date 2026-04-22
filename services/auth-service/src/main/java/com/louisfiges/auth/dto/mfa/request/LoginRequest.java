package com.louisfiges.auth.dto.mfa.request;

public record LoginRequest(
        String username,
        String password,
        String mfaCode,
        String deviceToken,
        String deviceFingerprint,
        Boolean trustDevice  // Nullable Boolean
) {
    public String mfaCode() {
        return mfaCode != null ? mfaCode : "";
    }

    public String deviceToken() {
        return deviceToken != null ? deviceToken : "";
    }

    public String deviceFingerprint() {
        return deviceFingerprint != null ? deviceFingerprint : "";
    }

    public boolean shouldTrustDevice() {
        return trustDevice != null && trustDevice;
    }
}