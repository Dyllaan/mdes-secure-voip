package com.louisfiges.auth.dto.response;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthSuccessResponse(
        String username,
        String accessToken,
        @JsonIgnore
        String refreshToken,
        boolean mfaEnabled,
        String deviceToken
) {}
