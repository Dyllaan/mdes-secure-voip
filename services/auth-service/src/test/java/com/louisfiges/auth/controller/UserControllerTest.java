package com.louisfiges.auth.controller;

import com.louisfiges.auth.dto.mfa.request.LoginRequest;
import com.louisfiges.auth.dto.mfa.request.MfaVerifyRequest;
import com.louisfiges.auth.dto.response.AuthSuccessResponse;
import com.louisfiges.auth.dto.response.LoginResult;
import com.louisfiges.auth.http.RefreshTokenCookieFactory;
import com.louisfiges.auth.http.TrustedDeviceCookieFactory;
import com.louisfiges.auth.service.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
@DisplayName("UserController Tests")
class UserControllerTest {

    @Mock
    private UserService userService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new UserController(userService)).build();
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("Should return forbidden login response with existing demo message")
    void shouldReturnForbiddenLoginResponseWithExistingDemoMessage() throws Exception {
        when(userService.login(eq("testuser"), eq("password123"), eq(""), eq(""), eq(""), eq(false)))
                .thenReturn(new LoginResult.DemoRateLimited("demo_token"));

        mockMvc.perform(post("/user/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("testuser", "password123", null, null, null, false)
                        )))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.demoToken").value("demo_token"))
                .andExpect(jsonPath("$.message").value("Your demo session has expired. Use the demo token to delete your account."));
    }

    @Test
    @DisplayName("Should return successful login response when not rate limited")
    void shouldReturnSuccessfulLoginResponseWhenNotRateLimited() throws Exception {
        when(userService.login(eq("testuser"), eq("password123"), eq(""), eq(""), eq(""), eq(false)))
                .thenReturn(new LoginResult.Success(
                        new AuthSuccessResponse("testuser", "access_token", "refresh_token", false, null)
                ));

        mockMvc.perform(post("/user/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("testuser", "password123", null, null, null, false)
                        )))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("testuser"))
                .andExpect(jsonPath("$.accessToken").value("access_token"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString(RefreshTokenCookieFactory.COOKIE_NAME + "=refresh_token")))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("HttpOnly")));
    }

    @Test
    @DisplayName("Should set trusted device cookie when login returns a new trusted device token")
    void shouldSetTrustedDeviceCookieWhenLoginReturnsDeviceToken() throws Exception {
        when(userService.login(eq("testuser"), eq("password123"), eq(""), eq(""), eq(""), eq(true)))
                .thenReturn(new LoginResult.Success(
                        new AuthSuccessResponse("testuser", "access_token", "refresh_token", false, "trusted_device_token")
                ));

        mockMvc.perform(post("/user/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("testuser", "password123", null, null, null, true)
                        )))
                .andExpect(status().isOk())
                .andExpect(header().stringValues("Set-Cookie", org.hamcrest.Matchers.hasItems(
                        org.hamcrest.Matchers.containsString(RefreshTokenCookieFactory.COOKIE_NAME + "=refresh_token"),
                        org.hamcrest.Matchers.containsString(TrustedDeviceCookieFactory.COOKIE_NAME + "=trusted_device_token")
                )));
    }

    @Test
    @DisplayName("Should use trusted device cookie when request body omits device token")
    void shouldUseTrustedDeviceCookieWhenBodyOmitsDeviceToken() throws Exception {
        when(userService.login(eq("testuser"), eq("password123"), eq(""), eq("cookie-device-token"), eq("fingerprint"), eq(false)))
                .thenReturn(new LoginResult.Failure("Invalid credentials"));

        mockMvc.perform(post("/user/login")
                        .cookie(new jakarta.servlet.http.Cookie(TrustedDeviceCookieFactory.COOKIE_NAME, "cookie-device-token"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new LoginRequest("testuser", "password123", null, null, "fingerprint", false)
                        )))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Should return forbidden refresh response with existing demo message")
    void shouldReturnForbiddenRefreshResponseWithExistingDemoMessage() throws Exception {
        when(userService.refreshToken("refresh_token"))
                .thenReturn(Optional.of(new LoginResult.DemoRateLimited("demo_token")));

        mockMvc.perform(post("/user/refresh")
                        .cookie(new jakarta.servlet.http.Cookie(RefreshTokenCookieFactory.COOKIE_NAME, "refresh_token")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.demoToken").value("demo_token"))
                .andExpect(jsonPath("$.message").value("Your demo session has expired. Use the demo token to delete your account."));
    }

    @Test
    @DisplayName("Should return forbidden MFA verify response with existing demo message")
    void shouldReturnForbiddenMfaVerifyResponseWithExistingDemoMessage() throws Exception {
        when(userService.verifyMfa("mfa_token", "123456", "device-fingerprint", true))
                .thenReturn(new LoginResult.DemoRateLimited("demo_token"));

        mockMvc.perform(post("/user/verify-mfa")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new MfaVerifyRequest("mfa_token", "123456", "device-fingerprint", true)
                        )))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.demoToken").value("demo_token"))
                .andExpect(jsonPath("$.message").value("Your demo session has expired. Use the demo token to delete your account."));
    }

    @Test
    @DisplayName("Should return successful refresh response when demo mode is off")
    void shouldReturnSuccessfulRefreshResponseWhenDemoModeIsOff() throws Exception {
        when(userService.refreshToken("refresh_token"))
                .thenReturn(Optional.of(new LoginResult.Success(
                        new AuthSuccessResponse("testuser", "access_token", "refresh_token", false, null)
                )));

        mockMvc.perform(post("/user/refresh")
                        .cookie(new jakarta.servlet.http.Cookie(RefreshTokenCookieFactory.COOKIE_NAME, "refresh_token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("testuser"))
                .andExpect(jsonPath("$.accessToken").value("access_token"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString(RefreshTokenCookieFactory.COOKIE_NAME + "=refresh_token")));
    }

    @Test
    @DisplayName("Should return unauthorized for invalid refresh token")
    void shouldReturnUnauthorizedForInvalidRefreshToken() throws Exception {
        when(userService.refreshToken("refresh_token")).thenReturn(Optional.empty());

        mockMvc.perform(post("/user/refresh")
                        .cookie(new jakarta.servlet.http.Cookie(RefreshTokenCookieFactory.COOKIE_NAME, "refresh_token")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.cause").value("Invalid refresh token"));
    }

    @Test
    @DisplayName("Should return unauthorized when refresh cookie is missing")
    void shouldReturnUnauthorizedWhenRefreshCookieIsMissing() throws Exception {
        mockMvc.perform(post("/user/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.cause").value("Invalid refresh token"));
    }
}
