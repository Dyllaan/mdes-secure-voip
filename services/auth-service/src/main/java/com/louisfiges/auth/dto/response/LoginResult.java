package com.louisfiges.auth.dto.response;

public sealed interface LoginResult permits LoginResult.Success, LoginResult.Failure, LoginResult.MfaRequired, LoginResult.DemoRateLimited {
    record Success(AuthSuccessResponse response) implements LoginResult {}
    record Failure(String reason) implements LoginResult {}
    record MfaRequired(String mfaToken, String message) implements LoginResult {}
    record DemoRateLimited(String demoToken) implements LoginResult {}
}
