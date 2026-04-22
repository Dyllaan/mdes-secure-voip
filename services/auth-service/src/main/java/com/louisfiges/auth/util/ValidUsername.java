package com.louisfiges.auth.util;

public class ValidUsername {
    public static boolean isValid(String username) {
        if (username == null) {
            return false;
        }

        return username.matches("^[a-zA-Z0-9_-]{3,48}$");
    }
}
