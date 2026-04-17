package com.louisfiges.auth.service;

import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.dto.response.RegisterResult;
import com.louisfiges.auth.dto.mfa.response.MfaSetupResponse;
import com.louisfiges.auth.dto.request.UpdatePasswordRequest;
import com.louisfiges.auth.dto.response.AuthSuccessResponse;
import com.louisfiges.auth.dto.response.DeleteResult;
import com.louisfiges.auth.dto.response.LoginResult;
import com.louisfiges.auth.dto.response.UpdatePasswordResult;
import com.louisfiges.auth.http.exceptions.MfaValidationException;
import com.louisfiges.auth.repo.UserRepository;
import com.louisfiges.auth.config.DemoLimiter;
import com.louisfiges.auth.token.DemoTokenProvider;
import com.louisfiges.auth.token.MfaTokenProvider;
import com.louisfiges.auth.token.TokenDenyList;
import com.louisfiges.auth.token.UserTokenProvider;
import dev.samstevens.totp.exceptions.QrGenerationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("UserService Tests")
class UserServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private UserTokenProvider userTokenProvider;

    @Mock
    private MfaTokenProvider mfaTokenProvider;

    @Mock
    private DemoTokenProvider demoTokenProvider;

    @Mock
    private TotpService totpService;

    @Mock
    private BackupCodeService backupCodeService;

    @Mock
    private TrustedDeviceService trustedDeviceService;

    @InjectMocks
    private UserService userService;

    @Captor
    private ArgumentCaptor<UserDAO> userCaptor;

    @Mock
    private TokenDenyList tokenDenyList;

    @Mock
    private DemoLimiter demoLimiter;

    @Mock
    private DemoSessionService demoSessionService;

    private UserDAO testUser;
    private static final String USERNAME = "testuser";
    private static final String PASSWORD = "password123";
    private static final String ENCODED_PASSWORD = "encoded_password";
    private static final String ACCESS_TOKEN = "access_token";
    private static final String REFRESH_TOKEN = "refresh_token";
    private static final String MFA_TOKEN = "mfa_token";
    private static final String MFA_CODE = "123456";
    private static final String MFA_SECRET = "mfa_secret";
    private static final String DEVICE_TOKEN = "device_token";
    private static final String DEVICE_FINGERPRINT = "fingerprint";
    private static final UUID USER_ID = UUID.fromString("123e4567-e89b-12d3-a456-426614174000");

    @BeforeEach
    void setUp() {
        testUser = new UserDAO(USERNAME, ENCODED_PASSWORD, LocalDateTime.now(), false);
        testUser.setId(USER_ID);
        lenient().when(demoLimiter.isDemoMode()).thenReturn(false);
    }

    @Nested
    @DisplayName("Login Tests")
    class LoginTests {

        @Test
        @DisplayName("Should login successfully with valid credentials and no MFA")
        void shouldLoginSuccessfullyWithoutMfa() {
            // Given
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, null, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            LoginResult.Success success = (LoginResult.Success) result;
            assertThat(success.response().username()).isEqualTo(USERNAME);
            assertThat(success.response().accessToken()).isEqualTo(ACCESS_TOKEN);
            assertThat(success.response().refreshToken()).isEqualTo(REFRESH_TOKEN);
            assertThat(success.response().mfaEnabled()).isFalse();
            assertThat(success.response().deviceToken()).isNull();

            verify(userRepository).findByUsername(USERNAME);
            verify(passwordEncoder).matches(PASSWORD, ENCODED_PASSWORD);
        }

        @Test
        @DisplayName("Should fail login with invalid username")
        void shouldFailLoginWithInvalidUsername() {
            // Given
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.empty());

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, null, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result).reason()).isEqualTo("Invalid credentials");

            verify(userRepository).findByUsername(USERNAME);
            verify(passwordEncoder, never()).matches(anyString(), anyString());
        }

        @Test
        @DisplayName("Should fail login with invalid password")
        void shouldFailLoginWithInvalidPassword() {
            // Given
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(false);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, null, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result).reason()).isEqualTo("Invalid credentials");
        }

        @Test
        @DisplayName("Should require MFA when enabled and not trusted device")
        void shouldRequireMfaWhenEnabled() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(mfaTokenProvider.generateToken(USER_ID)).thenReturn(MFA_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, null, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.MfaRequired.class);
            LoginResult.MfaRequired mfaRequired = (LoginResult.MfaRequired) result;
            assertThat(mfaRequired.mfaToken()).isEqualTo(MFA_TOKEN);
            assertThat(mfaRequired.message()).isEqualTo("MFA code required");

            verify(mfaTokenProvider).generateToken(USER_ID);
        }

        @Test
        @DisplayName("Should skip MFA for trusted device")
        void shouldSkipMfaForTrustedDevice() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(trustedDeviceService.isDeviceTrusted(DEVICE_TOKEN, DEVICE_FINGERPRINT)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, null, DEVICE_TOKEN, DEVICE_FINGERPRINT, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            verify(trustedDeviceService).isDeviceTrusted(DEVICE_TOKEN, DEVICE_FINGERPRINT);
            verify(totpService, never()).verifyCode(anyString(), anyString());
        }

        @Test
        @DisplayName("Should verify MFA code and login successfully")
        void shouldVerifyMfaCodeAndLogin() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, MFA_CODE, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            verify(totpService).verifyCode(MFA_SECRET, MFA_CODE);
        }

        @Test
        @DisplayName("Should verify backup code when TOTP fails")
        void shouldVerifyBackupCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);
            when(backupCodeService.verifyAndUseBackupCode(testUser, MFA_CODE)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, MFA_CODE, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            verify(totpService).verifyCode(MFA_SECRET, MFA_CODE);
            verify(backupCodeService).verifyAndUseBackupCode(testUser, MFA_CODE);
        }

        @Test
        @DisplayName("Should fail login with invalid MFA code")
        void shouldFailLoginWithInvalidMfaCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);
            when(backupCodeService.verifyAndUseBackupCode(testUser, MFA_CODE)).thenReturn(false);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, MFA_CODE, null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result).reason()).isEqualTo("Invalid MFA code");
        }

        @Test
        @DisplayName("Should create trusted device token when requested")
        void shouldCreateTrustedDeviceToken() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);
            when(trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Browser"))
                    .thenReturn(DEVICE_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, MFA_CODE, null, DEVICE_FINGERPRINT, true);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            LoginResult.Success success = (LoginResult.Success) result;
            assertThat(success.response().deviceToken()).isEqualTo(DEVICE_TOKEN);
            verify(trustedDeviceService).createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Browser");
        }

        @Test
        @DisplayName("Should handle empty MFA code as requiring MFA")
        void shouldHandleEmptyMfaCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(mfaTokenProvider.generateToken(USER_ID)).thenReturn(MFA_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, "", null, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.MfaRequired.class);
            verify(mfaTokenProvider).generateToken(USER_ID);
            verify(totpService, never()).verifyCode(anyString(), anyString());
        }

        @Test
        @DisplayName("Should not create device token when fingerprint is null even if trust is requested")
        void shouldNotCreateDeviceTokenWithoutFingerprint() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.login(USERNAME, PASSWORD, MFA_CODE, null, null, true);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            LoginResult.Success success = (LoginResult.Success) result;
            assertThat(success.response().deviceToken()).isNull();
            verify(trustedDeviceService, never()).createTrustedDevice(any(), any(), any());
        }

        @Test
        @DisplayName("Should allow first login in demo mode and record demo usage")
        void shouldAllowFirstLoginInDemoMode() {
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(demoSessionService.hasConsumedDemoLogin(USER_ID)).thenReturn(false);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            LoginResult result = userService.login(USERNAME, PASSWORD, null, null, null, false);

            assertThat(result).isInstanceOf(LoginResult.Success.class);
            verify(demoSessionService).recordFirstLogin(USER_ID);
            verify(demoTokenProvider, never()).generateToken(any());
        }

        @Test
        @DisplayName("Should reject repeat login in demo mode")
        void shouldRejectRepeatLoginInDemoMode() {
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(demoSessionService.hasConsumedDemoLogin(USER_ID)).thenReturn(true);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(demoTokenProvider.generateToken(USER_ID)).thenReturn("demo_token");

            LoginResult result = userService.login(USERNAME, PASSWORD, null, null, null, false);

            assertThat(result).isInstanceOf(LoginResult.DemoRateLimited.class);
            assertThat(((LoginResult.DemoRateLimited) result).demoToken()).isEqualTo("demo_token");
            verify(demoSessionService, never()).recordFirstLogin(USER_ID);
            verify(userTokenProvider, never()).generateAccessToken(any(), any());
            verify(userTokenProvider, never()).generateRefreshToken(any(), any());
        }

        @Test
        @DisplayName("Should reject trusted-device login when demo login already consumed")
        void shouldRejectTrustedDeviceLoginWhenDemoConsumed() {
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(demoSessionService.hasConsumedDemoLogin(USER_ID)).thenReturn(true);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(trustedDeviceService.isDeviceTrusted(DEVICE_TOKEN, DEVICE_FINGERPRINT)).thenReturn(true);
            when(demoTokenProvider.generateToken(USER_ID)).thenReturn("demo_token");

            LoginResult result = userService.login(USERNAME, PASSWORD, null, DEVICE_TOKEN, DEVICE_FINGERPRINT, false);

            assertThat(result).isInstanceOf(LoginResult.DemoRateLimited.class);
            verify(demoTokenProvider).generateToken(USER_ID);
            verify(userTokenProvider, never()).generateAccessToken(any(), any());
        }

        @Test
        @DisplayName("Should allow repeated login when demo mode is disabled")
        void shouldAllowRepeatedLoginWhenDemoModeDisabled() {
            when(demoLimiter.isDemoMode()).thenReturn(false);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            LoginResult firstResult = userService.login(USERNAME, PASSWORD, null, null, null, false);
            LoginResult secondResult = userService.login(USERNAME, PASSWORD, null, null, null, false);

            assertThat(firstResult).isInstanceOf(LoginResult.Success.class);
            assertThat(secondResult).isInstanceOf(LoginResult.Success.class);
            verify(demoSessionService, never()).recordFirstLogin(any());
            verify(demoTokenProvider, never()).generateToken(any());
        }

        @Test
        @DisplayName("Should allow exempt user to login repeatedly in demo mode")
        void shouldAllowExemptUserToLoginRepeatedlyInDemoMode() {
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(demoLimiter.isAllowedUser(USERNAME)).thenReturn(true);
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            LoginResult firstResult = userService.login(USERNAME, PASSWORD, null, null, null, false);
            LoginResult secondResult = userService.login(USERNAME, PASSWORD, null, null, null, false);

            assertThat(firstResult).isInstanceOf(LoginResult.Success.class);
            assertThat(secondResult).isInstanceOf(LoginResult.Success.class);
            verify(demoSessionService, never()).hasConsumedDemoLogin(any());
            verify(demoSessionService, never()).recordFirstLogin(any());
            verify(demoTokenProvider, never()).generateToken(any());
        }
    }

    @Nested
    @DisplayName("Verify MFA Tests")
    class VerifyMfaTests {

        @Test
        @DisplayName("Should verify MFA and return success with device trust")
        void shouldVerifyMfaSuccessfully() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Browser"))
                    .thenReturn(DEVICE_TOKEN);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When - NOTE: Current code has a bug where trustDevice must be true to succeed
            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, DEVICE_FINGERPRINT, true);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            verify(totpService).verifyCode(MFA_SECRET, MFA_CODE);
            verify(trustedDeviceService).createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Browser");
        }

        @Test
        @DisplayName("Should fail with invalid MFA token")
        void shouldFailWithInvalidMfaToken() {
            // Given
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.empty());

            // When
            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result).reason()).isEqualTo("Invalid or expired MFA token");
        }

        @Test
        @DisplayName("Should fail with invalid MFA code")
        void shouldFailWithInvalidMfaCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);
            when(backupCodeService.verifyAndUseBackupCode(testUser, MFA_CODE)).thenReturn(false);

            // When
            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result).reason()).isEqualTo("Invalid MFA code");
        }

        @Test
        @DisplayName("Should create device token when trust device is true")
        void shouldCreateDeviceTokenOnMfaVerification() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Browser"))
                    .thenReturn(DEVICE_TOKEN);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, DEVICE_FINGERPRINT, true);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            LoginResult.Success success = (LoginResult.Success) result;
            assertThat(success.response().deviceToken()).isEqualTo(DEVICE_TOKEN);
        }

        @Test
        @DisplayName("Should handle exceptions during MFA verification")
        void shouldHandleExceptionsDuringMfaVerification() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenThrow(new RuntimeException("TOTP service error"));

            // When
            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result).reason()).isEqualTo("TOTP service error");
        }

        @Test
        @DisplayName("Should verify MFA with backup code when TOTP fails")
        void shouldVerifyMfaWithBackupCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);
            when(backupCodeService.verifyAndUseBackupCode(testUser, MFA_CODE)).thenReturn(true);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, null, false);

            // Then
            assertThat(result).isInstanceOf(LoginResult.Success.class);
            verify(totpService).verifyCode(MFA_SECRET, MFA_CODE);
            verify(backupCodeService).verifyAndUseBackupCode(testUser, MFA_CODE);
        }

        @Test
        @DisplayName("Should reject MFA verification when demo login already consumed")
        void shouldRejectMfaVerificationWhenDemoConsumed() {
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(demoSessionService.hasConsumedDemoLogin(USER_ID)).thenReturn(true);
            when(mfaTokenProvider.validateAndGetUserId(MFA_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(demoTokenProvider.generateToken(USER_ID)).thenReturn("demo_token");

            LoginResult result = userService.verifyMfa(MFA_TOKEN, MFA_CODE, null, false);

            assertThat(result).isInstanceOf(LoginResult.DemoRateLimited.class);
            verify(demoTokenProvider).generateToken(USER_ID);
            verify(userTokenProvider, never()).generateAccessToken(any(), any());
            verify(userTokenProvider, never()).generateRefreshToken(any(), any());
        }
    }

    @Nested
    @DisplayName("Register Tests")
    class RegisterTests {

        @Test
        @DisplayName("Should register new user successfully")
        void shouldRegisterNewUser() {
            // Given
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.empty());
            when(passwordEncoder.encode(PASSWORD)).thenReturn(ENCODED_PASSWORD);
            when(userRepository.save(any(UserDAO.class))).thenReturn(testUser);
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            // When
            RegisterResult result = userService.register(USERNAME, PASSWORD, "127.0.0.1");

            // Then
            assertThat(result).isInstanceOf(RegisterResult.Success.class);
            RegisterResult.Success success = (RegisterResult.Success) result;
            assertThat(success.response().username()).isEqualTo(USERNAME);

            verify(userRepository).save(userCaptor.capture());
            UserDAO savedUser = userCaptor.getValue();
            assertThat(savedUser.getUsername()).isEqualTo(USERNAME);
            assertThat(savedUser.getPassword()).isEqualTo(ENCODED_PASSWORD);
            assertThat(savedUser.isMfaEnabled()).isFalse();
            assertThat(savedUser.getCreatedAt()).isNotNull();

            verify(passwordEncoder).encode(PASSWORD);
        }

        @Test
        @DisplayName("Should fail to register existing user")
        void shouldFailToRegisterExistingUser() {
            // Given
            when(userRepository.findByUsername(USERNAME)).thenReturn(Optional.of(testUser));

            // When
            RegisterResult result = userService.register(USERNAME, PASSWORD, "127.0.0.1");

            // Then
            assertThat(result).isInstanceOf(RegisterResult.UsernameTaken.class);
            verify(userRepository, never()).save(any(UserDAO.class));
        }
    }

    @Nested
    @DisplayName("Refresh Token Tests")
    class RefreshTokenTests {

        @Test
        @DisplayName("Should refresh token successfully")
        void shouldRefreshTokenSuccessfully() {
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(false);
            when(userTokenProvider.validateAndGetUserId(REFRESH_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(LoginResult.Success.class);
            verify(userTokenProvider).validateAndGetUserId(REFRESH_TOKEN);
        }

        @Test
        @DisplayName("Should reject valid refresh token in demo mode")
        void shouldRejectValidRefreshTokenInDemoMode() {
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(false);
            when(userTokenProvider.validateAndGetUserId(REFRESH_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(demoTokenProvider.generateToken(USER_ID)).thenReturn("demo_token");

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(LoginResult.DemoRateLimited.class);
            assertThat(((LoginResult.DemoRateLimited) result.get()).demoToken()).isEqualTo("demo_token");
            verify(userTokenProvider, never()).generateAccessToken(any(), any());
            verify(userTokenProvider, never()).generateRefreshToken(any(), any());
        }

        @Test
        @DisplayName("Should allow valid refresh token for exempt user in demo mode")
        void shouldAllowValidRefreshTokenForExemptUserInDemoMode() {
            when(demoLimiter.isDemoMode()).thenReturn(true);
            when(demoLimiter.isAllowedUser(USERNAME)).thenReturn(true);
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(false);
            when(userTokenProvider.validateAndGetUserId(REFRESH_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(userTokenProvider.generateAccessToken(USER_ID, USERNAME)).thenReturn(ACCESS_TOKEN);
            when(userTokenProvider.generateRefreshToken(USER_ID, USERNAME)).thenReturn(REFRESH_TOKEN);

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(LoginResult.Success.class);
            verify(demoTokenProvider, never()).generateToken(any());
        }

        @Test
        @DisplayName("Should fail with invalid refresh token")
        void shouldFailWithInvalidRefreshToken() {
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(false);
            when(userTokenProvider.validateAndGetUserId(REFRESH_TOKEN)).thenReturn(Optional.empty());

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("Should fail with invalid refresh token in demo mode")
        void shouldFailWithInvalidRefreshTokenInDemoMode() {
            lenient().when(demoLimiter.isDemoMode()).thenReturn(true);
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(false);
            when(userTokenProvider.validateAndGetUserId(REFRESH_TOKEN)).thenReturn(Optional.empty());

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isEmpty();
            verify(demoTokenProvider, never()).generateToken(any());
        }

        @Test
        @DisplayName("Should reject revoked refresh token")
        void shouldRejectRevokedRefreshToken() {
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(true);

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result.get()).reason()).isEqualTo("Token has expired, please re-login.");
            verify(userTokenProvider, never()).validateAndGetUserId(any());
        }

        @Test
        @DisplayName("Should reject revoked refresh token in demo mode")
        void shouldRejectRevokedRefreshTokenInDemoMode() {
            lenient().when(demoLimiter.isDemoMode()).thenReturn(true);
            when(tokenDenyList.isRevoked(REFRESH_TOKEN)).thenReturn(true);

            Optional<LoginResult> result = userService.refreshToken(REFRESH_TOKEN);

            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(LoginResult.Failure.class);
            assertThat(((LoginResult.Failure) result.get()).reason()).isEqualTo("Token has expired, please re-login.");
            verify(userTokenProvider, never()).validateAndGetUserId(any());
            verify(demoTokenProvider, never()).generateToken(any());
        }
    }

    @Nested
    @DisplayName("Update Password Tests")
    class UpdatePasswordTests {

        private static final String OLD_PASSWORD = "oldPassword";
        private static final String NEW_PASSWORD = "newPassword";
        private static final String NEW_ENCODED_PASSWORD = "new_encoded_password";

        @Test
        @DisplayName("Should update password without MFA")
        void shouldUpdatePasswordWithoutMfa() {
            // Given
            UpdatePasswordRequest request = new UpdatePasswordRequest(OLD_PASSWORD, NEW_PASSWORD, null);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(OLD_PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(passwordEncoder.encode(NEW_PASSWORD)).thenReturn(NEW_ENCODED_PASSWORD);
            when(userRepository.save(testUser)).thenReturn(testUser);

            // When
            Optional<UpdatePasswordResult> result = userService.updatePassword(ACCESS_TOKEN, request);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(UpdatePasswordResult.Success.class);
            assertThat(((UpdatePasswordResult.Success) result.get()).message())
                    .isEqualTo("Password updated successfully");

            verify(userRepository).save(userCaptor.capture());
            UserDAO savedUser = userCaptor.getValue();
            assertThat(savedUser.getPassword()).isEqualTo(NEW_ENCODED_PASSWORD);
        }

        @Test
        @DisplayName("Should require MFA when enabled")
        void shouldRequireMfaForPasswordUpdate() {
            // Given
            testUser.setMfaEnabled(true);
            UpdatePasswordRequest request = new UpdatePasswordRequest(OLD_PASSWORD, NEW_PASSWORD, null);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            Optional<UpdatePasswordResult> result = userService.updatePassword(ACCESS_TOKEN, request);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(UpdatePasswordResult.MfaRequired.class);
            verify(userRepository, never()).save(any());
        }

        @Test
        @DisplayName("Should update password with valid MFA")
        void shouldUpdatePasswordWithValidMfa() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            UpdatePasswordRequest request = new UpdatePasswordRequest(OLD_PASSWORD, NEW_PASSWORD, MFA_CODE);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);
            when(passwordEncoder.matches(OLD_PASSWORD, ENCODED_PASSWORD)).thenReturn(true);
            when(passwordEncoder.encode(NEW_PASSWORD)).thenReturn(NEW_ENCODED_PASSWORD);

            // When
            Optional<UpdatePasswordResult> result = userService.updatePassword(ACCESS_TOKEN, request);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(UpdatePasswordResult.Success.class);
            verify(totpService).verifyCode(MFA_SECRET, MFA_CODE);
        }

        @Test
        @DisplayName("Should fail with invalid MFA code")
        void shouldFailWithInvalidMfaCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            UpdatePasswordRequest request = new UpdatePasswordRequest(OLD_PASSWORD, NEW_PASSWORD, MFA_CODE);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);
            when(backupCodeService.verifyAndUseBackupCode(testUser, MFA_CODE)).thenReturn(false);

            // When
            Optional<UpdatePasswordResult> result = userService.updatePassword(ACCESS_TOKEN, request);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(UpdatePasswordResult.Failure.class);
            verify(userRepository, never()).save(any());
        }

        @Test
        @DisplayName("Should fail with incorrect old password")
        void shouldFailWithIncorrectOldPassword() {
            // Given
            UpdatePasswordRequest request = new UpdatePasswordRequest(OLD_PASSWORD, NEW_PASSWORD, null);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(passwordEncoder.matches(OLD_PASSWORD, ENCODED_PASSWORD)).thenReturn(false);

            // When
            Optional<UpdatePasswordResult> result = userService.updatePassword(ACCESS_TOKEN, request);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(UpdatePasswordResult.Failure.class);
            assertThat(((UpdatePasswordResult.Failure) result.get()).message())
                    .isEqualTo("Old password is incorrect");
        }

        @Test
        @DisplayName("Should fail with invalid token")
        void shouldFailWithInvalidToken() {
            // Given
            UpdatePasswordRequest request = new UpdatePasswordRequest(OLD_PASSWORD, NEW_PASSWORD, null);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.empty());

            // When
            Optional<UpdatePasswordResult> result = userService.updatePassword(ACCESS_TOKEN, request);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isInstanceOf(UpdatePasswordResult.Failure.class);
            assertThat(((UpdatePasswordResult.Failure) result.get()).message()).isEqualTo("Invalid token");
        }
    }

    @Nested
    @DisplayName("Get User From Token Tests")
    class GetUserFromTokenTests {

        @Test
        @DisplayName("Should get user from valid token")
        void shouldGetUserFromValidToken() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            Optional<UserDAO> result = userService.getUserFromToken(ACCESS_TOKEN);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isEqualTo(testUser);
        }

        @Test
        @DisplayName("Should return empty for invalid token")
        void shouldReturnEmptyForInvalidToken() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.empty());

            // When
            Optional<UserDAO> result = userService.getUserFromToken(ACCESS_TOKEN);

            // Then
            assertThat(result).isEmpty();
        }
    }

    @Nested
    @DisplayName("MFA Setup Tests")
    class MfaSetupTests {

        @Test
        @DisplayName("Should setup MFA for user without existing secret")
        void shouldSetupMfaWithNewSecret() throws QrGenerationException {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.generateSecret()).thenReturn(MFA_SECRET);
            when(totpService.generateQrCodeDataUri(MFA_SECRET, USERNAME)).thenReturn("qr_code_uri");
            List<String> backupCodes = List.of("backup1", "backup2");
            when(backupCodeService.generateAndSaveBackupCodes(testUser, 10)).thenReturn(backupCodes);

            // When
            Optional<MfaSetupResponse> result = userService.setupMfa(ACCESS_TOKEN);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get().secret()).isEqualTo(MFA_SECRET);
            assertThat(result.get().qrCode()).isEqualTo("qr_code_uri");
            assertThat(result.get().backupCodes()).isEqualTo(backupCodes);

            verify(userRepository).save(userCaptor.capture());
            UserDAO savedUser = userCaptor.getValue();
            assertThat(savedUser.getMfaSecret()).isEqualTo(MFA_SECRET);
            assertThat(savedUser.isMfaEnabled()).isFalse(); // Not enabled until verified
        }

        @Test
        @DisplayName("Should use existing secret if present")
        void shouldUseExistingSecret() throws QrGenerationException {
            // Given
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.generateQrCodeDataUri(MFA_SECRET, USERNAME)).thenReturn("qr_code_uri");

            // When
            Optional<MfaSetupResponse> result = userService.setupMfa(ACCESS_TOKEN);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get().secret()).isEqualTo(MFA_SECRET);
            assertThat(result.get().qrCode()).isEqualTo("qr_code_uri");
            assertThat(result.get().backupCodes()).isEmpty(); // No new backup codes when secret exists
            verify(totpService, never()).generateSecret();
            verify(userRepository, never()).save(any()); // Don't save when secret already exists
        }

        @Test
        @DisplayName("Should return empty if MFA already enabled")
        void shouldReturnEmptyIfMfaAlreadyEnabled() {
            // Given
            testUser.setMfaEnabled(true);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            Optional<MfaSetupResponse> result = userService.setupMfa(ACCESS_TOKEN);

            // Then
            assertThat(result).isEmpty();
            verify(totpService, never()).generateSecret();
            verify(userRepository, never()).save(any());
        }

        @Test
        @DisplayName("Should return empty if QR generation fails")
        void shouldReturnEmptyIfQrGenerationFails() throws QrGenerationException {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.generateSecret()).thenReturn(MFA_SECRET);
            when(totpService.generateQrCodeDataUri(MFA_SECRET, USERNAME))
                    .thenThrow(new QrGenerationException("QR generation failed", null));

            // When
            Optional<MfaSetupResponse> result = userService.setupMfa(ACCESS_TOKEN);

            // Then
            assertThat(result).isEmpty();
            // User was still saved with the secret before QR generation failed
            verify(userRepository).save(any());
        }

        @Test
        @DisplayName("Should return empty if token is invalid")
        void shouldReturnEmptyIfTokenInvalid() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.empty());

            // When
            Optional<MfaSetupResponse> result = userService.setupMfa(ACCESS_TOKEN);

            // Then
            assertThat(result).isEmpty();
            verify(totpService, never()).generateSecret();
        }
    }

    @Nested
    @DisplayName("Verify and Enable MFA Tests")
    class VerifyAndEnableMfaTests {

        @Test
        @DisplayName("Should enable MFA with valid code")
        void shouldEnableMfaWithValidCode() {
            // Given
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);

            // When
            Optional<String> result = userService.verifyAndEnableMfa(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isEqualTo("MFA enabled successfully");
            assertThat(testUser.isMfaEnabled()).isTrue();
            verify(userRepository).save(testUser);
        }

        @Test
        @DisplayName("Should fail with invalid code")
        void shouldFailWithInvalidCode() {
            // Given
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);

            // When
            Optional<String> result = userService.verifyAndEnableMfa(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isEmpty();
            verify(userRepository, never()).save(any());
        }

        @Test
        @DisplayName("Should fail if no MFA secret exists")
        void shouldFailIfNoMfaSecret() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            Optional<String> result = userService.verifyAndEnableMfa(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isEmpty();
        }
    }

    @Nested
    @DisplayName("Disable MFA Tests")
    class DisableMfaTests {

        @Test
        @DisplayName("Should disable MFA with valid code")
        void shouldDisableMfaWithValidCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);

            // When
            Optional<String> result = userService.disableMfa(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isPresent();
            assertThat(result.get()).isEqualTo("MFA disabled successfully");
            assertThat(testUser.isMfaEnabled()).isFalse();
            assertThat(testUser.getMfaSecret()).isNull();
            verify(backupCodeService).deleteBackupCodes(testUser);
            verify(userRepository).save(testUser);
        }

        @Test
        @DisplayName("Should fail if MFA not enabled")
        void shouldFailIfMfaNotEnabled() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            Optional<String> result = userService.disableMfa(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isEmpty();
        }

        @Test
        @DisplayName("Should fail with invalid code")
        void shouldFailWithInvalidCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);

            // When
            Optional<String> result = userService.disableMfa(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isEmpty();
            verify(userRepository, never()).save(any());
        }
    }

    @Nested
    @DisplayName("Delete User Tests")
    class DeleteUserTests {

        @Test
        @DisplayName("Should delete user without MFA")
        void shouldDeleteUserWithoutMfa() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            DeleteResult result = userService.deleteUser(ACCESS_TOKEN, null);

            // Then
            assertThat(result).isInstanceOf(DeleteResult.Success.class);
            assertThat(((DeleteResult.Success) result).message()).isEqualTo("User deleted successfully");
            verify(userRepository).delete(testUser);
        }

        @Test
        @DisplayName("Should require MFA when enabled")
        void shouldRequireMfaForDeletion() {
            // Given
            testUser.setMfaEnabled(true);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));

            // When
            DeleteResult result = userService.deleteUser(ACCESS_TOKEN, null);

            // Then
            assertThat(result).isInstanceOf(DeleteResult.MfaRequired.class);
            verify(userRepository, never()).delete(any());
        }

        @Test
        @DisplayName("Should delete user with valid MFA")
        void shouldDeleteUserWithValidMfa() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(true);

            // When
            DeleteResult result = userService.deleteUser(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isInstanceOf(DeleteResult.Success.class);
            verify(userRepository).delete(testUser);
        }

        @Test
        @DisplayName("Should fail with invalid MFA code")
        void shouldFailWithInvalidMfaCode() {
            // Given
            testUser.setMfaEnabled(true);
            testUser.setMfaSecret(MFA_SECRET);
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.of(USER_ID));
            when(userRepository.findById(USER_ID)).thenReturn(Optional.of(testUser));
            when(totpService.verifyCode(MFA_SECRET, MFA_CODE)).thenReturn(false);
            when(backupCodeService.verifyAndUseBackupCode(testUser, MFA_CODE)).thenReturn(false);

            // When
            DeleteResult result = userService.deleteUser(ACCESS_TOKEN, MFA_CODE);

            // Then
            assertThat(result).isInstanceOf(DeleteResult.Failure.class);
            verify(userRepository, never()).delete(any());
        }

        @Test
        @DisplayName("Should fail with invalid token")
        void shouldFailWithInvalidToken() {
            // Given
            when(userTokenProvider.validateAndGetUserId(ACCESS_TOKEN)).thenReturn(Optional.empty());

            // When
            DeleteResult result = userService.deleteUser(ACCESS_TOKEN, null);

            // Then
            assertThat(result).isInstanceOf(DeleteResult.Failure.class);
            assertThat(((DeleteResult.Failure) result).reason()).isEqualTo("Invalid token");
        }
    }
}
