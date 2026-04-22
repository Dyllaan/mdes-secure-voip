package com.louisfiges.auth.config;

import org.springframework.stereotype.Component;

import java.util.Locale;

@Component
public class BotAuthConfig {
    private final String botSecret;
    private final String botUsername;
    private final String botPassword;

    public BotAuthConfig() {
        this.botSecret = System.getenv().getOrDefault("BOT_SECRET", "");
        this.botUsername = System.getenv().getOrDefault("BOT_USERNAME", "").trim().toLowerCase(Locale.ROOT);
        this.botPassword = System.getenv().getOrDefault("BOT_PASSWORD", "");
    }

    public boolean isEnabled() {
        return !botSecret.isBlank() && !botUsername.isBlank() && !botPassword.isBlank();
    }

    public boolean isAllowedUsername(String username) {
        return username != null && botUsername.equals(username.trim().toLowerCase(Locale.ROOT));
    }

    public boolean hasMatchingSecret(String candidate) {
        return !botSecret.isBlank() && botSecret.equals(candidate);
    }

    public String botPassword() {
        return botPassword;
    }
}
