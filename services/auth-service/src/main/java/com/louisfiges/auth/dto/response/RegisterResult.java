package com.louisfiges.auth.dto.response;

public sealed interface RegisterResult permits RegisterResult.Success, RegisterResult.UsernameTaken, RegisterResult.Banned {
    record Success(AuthSuccessResponse response) implements RegisterResult {}
    record UsernameTaken() implements RegisterResult {}
    record Banned() implements RegisterResult {}
}
