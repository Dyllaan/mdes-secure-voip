package com.louisfiges.auth.dto.response;

public record UserResponse(String username, boolean mfaEnabled) {}