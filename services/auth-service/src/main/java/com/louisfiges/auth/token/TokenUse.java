package com.louisfiges.auth.token;

public enum TokenUse {
    ACCESS("access", "voip-services"),
    REFRESH("refresh", "auth-service"),
    MFA("mfa", "auth-service"),
    DEMO("demo", "auth-service");

    private final String value;
    private final String audience;

    TokenUse(String value, String audience) {
        this.value = value;
        this.audience = audience;
    }

    public String value() {
        return value;
    }

    public String audience() {
        return audience;
    }
}
