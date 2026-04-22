package com.louisfiges.auth.dto.mfa.response;

import com.louisfiges.auth.dto.response.Response;

public record MfaInvalidResponse(String message) implements Response {
}
