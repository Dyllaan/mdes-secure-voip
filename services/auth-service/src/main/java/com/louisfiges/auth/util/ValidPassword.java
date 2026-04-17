package com.louisfiges.auth.util;

public class ValidPassword {

    /**
     * Check if the password is valid
     * requirements:
     * - at least 8 characters
     * - at least one uppercase letter
     * - at least one lowercase letter
     * - at least one digit
     * @param password
     * @return
     */
    public static boolean isValid(String password) {
        if (password == null || password.length() < 8 || password.length() > 128) {
            return false;
        }

        boolean hasUpper = false;
        boolean hasLower = false;
        boolean hasDigit = false;

        for (char c : password.toCharArray()) {
            if (Character.isUpperCase(c)) hasUpper = true;
            else if (Character.isLowerCase(c)) hasLower = true;
            else if (Character.isDigit(c)) hasDigit = true;
        }

        return hasUpper && hasLower && hasDigit;
    }
}
