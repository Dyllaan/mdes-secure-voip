package com.louisfiges.auth.dto.request;

public record UpdatePasswordRequest(String oldPassword, String newPassword, String mfaCode) {
    // Provide defaults for null values
    public String mfaCode() {
        return mfaCode != null ? mfaCode : "";
    }
}
