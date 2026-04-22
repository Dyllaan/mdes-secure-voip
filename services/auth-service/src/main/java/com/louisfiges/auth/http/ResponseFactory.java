package com.louisfiges.auth.http;

import com.louisfiges.auth.dto.response.AuthSuccessResponse;
import com.louisfiges.auth.dto.response.LoginResult;
import com.louisfiges.auth.dto.mfa.response.MfaInvalidResponse;
import com.louisfiges.auth.dto.mfa.response.MfaSetupResponse;
import com.louisfiges.common.dto.StringErrorResponse;

import java.util.List;

public class ResponseFactory {

    public static LoginResult loginResponse(String username, String authToken, String refreshToken, boolean mfaEnabled, String deviceToken) {
        return new LoginResult.Success(
                new AuthSuccessResponse(username, authToken, refreshToken, mfaEnabled, deviceToken)
        );
    }

    public static LoginResult expiredTokenResponse() {
        return new LoginResult.Failure("Token has expired, please re-login.");
    }

    public static StringErrorResponse error(String cause) {
        return new StringErrorResponse(cause);
    }

    public static MfaSetupResponse mfaSuccess(String secret, String qrCode, List<String> backupCodes, String message) {
        return new MfaSetupResponse(secret, qrCode, backupCodes, message);
    }

    public static MfaInvalidResponse mfaInvalid(String message) {
        return new MfaInvalidResponse(message);
    }


}
