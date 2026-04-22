package com.louisfiges.auth.controller;

import com.louisfiges.auth.config.BotAuthConfig;
import com.louisfiges.auth.dto.mfa.request.LoginRequest;
import com.louisfiges.auth.dto.mfa.request.MfaVerifyRequest;
import com.louisfiges.auth.dto.request.AuthRequest;
import com.louisfiges.auth.dto.request.DeleteUserRequest;
import com.louisfiges.auth.dto.response.DeleteResult;
import com.louisfiges.auth.dto.response.AuthSuccessResponse;
import com.louisfiges.auth.dto.response.LoginResult;
import com.louisfiges.auth.dto.response.RegisterResult;
import com.louisfiges.auth.dto.request.UpdatePasswordRequest;
import com.louisfiges.auth.dto.response.UpdatePasswordResult;
import com.louisfiges.auth.dto.response.UserResponse;
import com.louisfiges.auth.http.RefreshTokenCookieFactory;
import com.louisfiges.auth.http.TrustedDeviceCookieFactory;
import com.louisfiges.auth.service.UserService;
import com.louisfiges.auth.util.ValidPassword;
import com.louisfiges.auth.util.ValidUsername;
import com.louisfiges.common.dto.StringErrorResponse;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.louisfiges.auth.http.ResponseFactory;

import java.util.Map;

/**
 * Lockout and backoff handled at service layer, controller just returns appropriate status codes and messages based on service response.
 */

@RestController
@RequestMapping("/user")
public class UserController {

    private final UserService userService;
    private final BotAuthConfig botAuthConfig;

    public UserController(UserService userService, BotAuthConfig botAuthConfig) {
        this.userService = userService;
        this.botAuthConfig = botAuthConfig;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        LoginResult result = userService.login(
                request.username(),
                request.password(),
                request.mfaCode(),
                resolveTrustedDeviceToken(request, httpRequest),
                request.deviceFingerprint(),
                request.shouldTrustDevice()
        );

        return switch (result) {
            case LoginResult.Success success -> withAuthCookies(ResponseEntity.ok(), success.response(), httpRequest)
                    .body(success.response());
            case LoginResult.Failure failure -> ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new StringErrorResponse(failure.reason()));
            case LoginResult.MfaRequired mfaRequired -> ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(Map.of("mfaToken", mfaRequired.mfaToken(), "message", mfaRequired.message()));
            case LoginResult.DemoRateLimited demoRateLimited -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of(
                            "demoToken", demoRateLimited.demoToken(),
                            "message", "Your demo session has expired. Use the demo token to delete your account."
                    ));
        };
    }

    @PostMapping("/verify-mfa")
    public ResponseEntity<?> verifyMfa(@RequestBody MfaVerifyRequest request, HttpServletRequest httpRequest) {
        LoginResult result = userService.verifyMfa(
                request.mfaToken(),
                request.code(),
                request.deviceFingerprint(),
                request.trustDevice()
        );

        return switch (result) {
            case LoginResult.Success success -> withAuthCookies(ResponseEntity.ok(), success.response(), httpRequest)
                    .body(success.response());
            case LoginResult.Failure failure -> ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new StringErrorResponse(failure.reason()));
            case LoginResult.DemoRateLimited demoRateLimited -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of(
                            "demoToken", demoRateLimited.demoToken(),
                            "message", "Your demo session has expired. Use the demo token to delete your account."
                    ));
            case LoginResult.MfaRequired ignored -> ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new StringErrorResponse("Unexpected state"));
        };
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(HttpServletRequest request) {
        String refreshToken = getRefreshTokenCookie(request);
        if (refreshToken == null || refreshToken.isBlank()) {
            return ResponseEntity.status(401).body(ResponseFactory.error("Invalid refresh token"));
        }

        return userService.refreshToken(refreshToken)
                .map(result -> switch (result) {
                    case LoginResult.Success success -> ResponseEntity.ok()
                            .header(HttpHeaders.SET_COOKIE, RefreshTokenCookieFactory.build(success.response().refreshToken(), isSecureRequest(request)).toString())
                            .body(success.response());
                    case LoginResult.DemoRateLimited demoRateLimited -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                            .body(Map.of(
                                    "demoToken", demoRateLimited.demoToken(),
                                    "message", "Your demo session has expired. Use the demo token to delete your account."
                            ));
                    case LoginResult.Failure failure -> ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(ResponseFactory.error(failure.reason()));
                    case LoginResult.MfaRequired ignored -> ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                            .body(ResponseFactory.error("Unexpected state"));
                })
                .orElseGet(() -> ResponseEntity.status(401).body(ResponseFactory.error("Invalid refresh token")));
    }

    @GetMapping("/me")
    public ResponseEntity<?> getCurrentUser(@RequestHeader("Authorization") String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401)
                    .body(ResponseFactory.error("Missing or invalid authorization header"));
        }

        String token = authHeader.substring(7);

        return userService.getUserFromToken(token)
                .<ResponseEntity<?>>map(user ->
                        ResponseEntity.ok(new UserResponse(user.getUsername(), user.isMfaEnabled()))
                )
                .orElseGet(() -> ResponseEntity.status(401).body(ResponseFactory.error("Invalid token")));
    }

    @PostMapping("/update-password")
    public ResponseEntity<?> updatePassword(
            @RequestHeader("Authorization") String authHeader,
            @RequestBody UpdatePasswordRequest request) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401)
                    .body(ResponseFactory.error("Missing or invalid authorization header"));
        }

        if (!ValidPassword.isValid(request.newPassword())) {
            return ResponseEntity.badRequest()
                    .body(ResponseFactory.error("Password does not meet complexity requirements"));
        }

        String token = authHeader.substring(7);

        return userService.updatePassword(token, request)
                .map(result -> switch (result) {
                    case UpdatePasswordResult.Success success ->
                            ResponseEntity.ok(Map.of("message", success.message()));
                    case UpdatePasswordResult.MfaRequired mfaRequired -> ResponseEntity.status(HttpStatus.BAD_REQUEST)
                            .body(new StringErrorResponse(mfaRequired.message()));
                    case UpdatePasswordResult.Failure failure -> ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(new StringErrorResponse(failure.message()));
                })
                .orElseGet(() -> ResponseEntity.status(401).body(ResponseFactory.error("Invalid token")));
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody AuthRequest request, HttpServletRequest httpRequest) {
        if (!ValidPassword.isValid(request.password())) {
            return ResponseEntity.badRequest()
                    .body(ResponseFactory.error("Password does not meet complexity requirements"));
        }

        if (!ValidUsername.isValid(request.username())) {
            return ResponseEntity.badRequest()
                    .body(ResponseFactory.error("Username is invalid. It must be 3-48 characters long and can only contain letters, numbers, underscores, and hyphens."));
        }

        return switch (userService.register(request.username(), request.password())) {
            case RegisterResult.Success success -> ResponseEntity.status(HttpStatus.CREATED)
                    .header(HttpHeaders.SET_COOKIE, RefreshTokenCookieFactory.build(success.response().refreshToken(), isSecureRequest(httpRequest)).toString())
                    .body(success.response());
            case RegisterResult.UsernameTaken ignored -> ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ResponseFactory.error("Username already exists"));
            case RegisterResult.Banned ignored -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ResponseFactory.error("Registration not permitted"));
        };
    }

    @PostMapping("/bot-login")
    public ResponseEntity<?> botLogin(
            @RequestHeader(value = "X-Bot-Secret", required = false) String botSecret,
            @RequestBody AuthRequest request,
            HttpServletRequest httpRequest
    ) {
        if (!botAuthConfig.isEnabled()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ResponseFactory.error("Bot login is disabled"));
        }
        if (!botAuthConfig.isAllowedUsername(request.username())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ResponseFactory.error("Bot login not permitted"));
        }
        if (!botAuthConfig.hasMatchingSecret(botSecret)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ResponseFactory.error("Invalid bot secret"));
        }

        AuthSuccessResponse response = userService.upsertServiceUser(request.username(), botAuthConfig.botPassword());
        return withAuthCookies(ResponseEntity.ok(), response, httpRequest).body(response);
    }

    @DeleteMapping("/delete")
    public ResponseEntity<?> deleteUser(
            @RequestHeader("Authorization") String authHeader,
            @RequestBody(required = false) DeleteUserRequest request) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401)
                    .body(ResponseFactory.error("Missing or invalid authorization header"));
        }

        String token = authHeader.substring(7);
        String mfaCode = request != null ? request.mfaCode() : null;
        DeleteResult result = userService.deleteUser(token, mfaCode);

        return switch (result) {
            case DeleteResult.Success success ->
                    ResponseEntity.ok(Map.of("message", success.message()));
            case DeleteResult.MfaRequired mfaRequired ->
                    ResponseEntity.status(HttpStatus.BAD_REQUEST)
                            .body(new StringErrorResponse(mfaRequired.message()));
            case DeleteResult.Failure failure ->
                    ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                            .body(new StringErrorResponse(failure.reason()));
        };
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(
            @RequestHeader("Authorization") String authHeader,
            HttpServletRequest request) {

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(401).body(ResponseFactory.error("Missing or invalid authorization header"));
        }

        userService.logout(authHeader.substring(7), getRefreshTokenCookie(request));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, RefreshTokenCookieFactory.clear(isSecureRequest(request)).toString())
                .body(Map.of("message", "Logged out successfully"));
    }

    private String extractClientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private String getRefreshTokenCookie(HttpServletRequest request) {
        return getCookieValue(request, RefreshTokenCookieFactory.COOKIE_NAME);
    }

    private String resolveTrustedDeviceToken(LoginRequest request, HttpServletRequest httpRequest) {
        if (!request.deviceToken().isBlank()) {
            return request.deviceToken();
        }
        String cookieToken = getCookieValue(httpRequest, TrustedDeviceCookieFactory.COOKIE_NAME);
        return cookieToken == null ? "" : cookieToken;
    }

    private String getCookieValue(HttpServletRequest request, String cookieName) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (cookieName.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private ResponseEntity.BodyBuilder withAuthCookies(
            ResponseEntity.BodyBuilder builder,
            com.louisfiges.auth.dto.response.AuthSuccessResponse response,
            HttpServletRequest request
    ) {
        boolean secure = isSecureRequest(request);
        builder.header(HttpHeaders.SET_COOKIE, RefreshTokenCookieFactory.build(response.refreshToken(), secure).toString());
        if (response.deviceToken() != null && !response.deviceToken().isBlank()) {
            builder.header(HttpHeaders.SET_COOKIE, TrustedDeviceCookieFactory.build(response.deviceToken(), secure).toString());
        }
        return builder;
    }

    private boolean isSecureRequest(HttpServletRequest request) {
        String forwardedProto = request.getHeader("X-Forwarded-Proto");
        if (forwardedProto != null) {
            return "https".equalsIgnoreCase(forwardedProto);
        }
        return request.isSecure();
    }
}
