package com.louisfiges.auth.config;

import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class DemoLimiter {
    private final boolean demoMode;
    private final Set<String> allowedUsers;

    public DemoLimiter() {
        this.demoMode = "true".equalsIgnoreCase(System.getenv("DEMO_MODE"));
        this.allowedUsers = Arrays.stream(System.getenv().getOrDefault("DEMO_ALLOWED_USERS", "").split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .map(value -> value.toLowerCase(Locale.ROOT))
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isDemoMode() {
        return demoMode;
    }

    public boolean isAllowedUser(String username) {
        return username != null && allowedUsers.contains(username.trim().toLowerCase(Locale.ROOT));
    }
}
