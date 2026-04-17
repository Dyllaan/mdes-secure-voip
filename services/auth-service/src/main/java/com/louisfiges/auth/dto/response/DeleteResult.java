package com.louisfiges.auth.dto.response;

public sealed interface DeleteResult {
    record Success(String message) implements DeleteResult {}
    record MfaRequired(String message) implements DeleteResult {}
    record Failure(String reason) implements DeleteResult {}
}