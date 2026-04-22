package com.louisfiges.auth.http.exceptions;

public class MfaValidationException extends Exception {
    public MfaValidationException(String message) {
        super(message);
    }
}
