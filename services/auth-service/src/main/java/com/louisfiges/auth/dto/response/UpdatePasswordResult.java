package com.louisfiges.auth.dto.response;

public sealed interface UpdatePasswordResult permits UpdatePasswordResult.Failure, UpdatePasswordResult.MfaRequired, UpdatePasswordResult.Success {
    record Success(String message) implements UpdatePasswordResult {}
    record Failure(String message) implements UpdatePasswordResult {}
    record MfaRequired(String message) implements UpdatePasswordResult {}
}