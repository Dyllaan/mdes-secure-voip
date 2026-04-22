package com.louisfiges.auth.constants;

import java.util.Arrays;
import java.util.List;

public class PublicPaths {
    private static final List<String> PUBLIC_PATHS = Arrays.asList(
            "/user/login", "/user/refresh", "/user/register", "/user/verify-mfa", "/user/bot-login", "/version", "/actuator/health"
    );

    public static boolean isPublicPath(String path) {
        return PUBLIC_PATHS.contains(path);
    }

    public static List<String> getPublicPaths() {
        return PUBLIC_PATHS;
    }
}
