package com.louisfiges.auth.service;

import com.louisfiges.auth.config.DemoLimiter;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.dto.response.AuthSuccessResponse;
import com.louisfiges.auth.dto.response.DeleteResult;
import com.louisfiges.auth.dto.mfa.response.MfaSetupResponse;
import com.louisfiges.auth.dto.response.LoginResult;
import com.louisfiges.auth.dto.response.RegisterResult;
import com.louisfiges.auth.dto.request.UpdatePasswordRequest;
import com.louisfiges.auth.dto.response.UpdatePasswordResult;
import com.louisfiges.auth.http.ResponseFactory;
import com.louisfiges.auth.http.exceptions.MfaValidationException;
import com.louisfiges.auth.repo.UserRepository;
import com.louisfiges.auth.token.DemoTokenProvider;
import com.louisfiges.auth.token.MfaTokenProvider;
import com.louisfiges.auth.token.RefreshTokenProvider;
import com.louisfiges.auth.token.TokenDenyList;
import com.louisfiges.auth.token.UserTokenProvider;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Locale;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final UserTokenProvider userTokenProvider;
    private final RefreshTokenProvider refreshTokenProvider;
    private final MfaTokenProvider mfaTokenProvider;
    private final DemoTokenProvider demoTokenProvider;
    private final TotpService totpService;
    private final BackupCodeService backupCodeService;
    private final TrustedDeviceService trustedDeviceService;
    private final TokenDenyList tokenDenyList;
    private final DemoLimiter demoLimiter;
    private final DemoSessionService demoSessionService;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder,
                       UserTokenProvider userTokenProvider, RefreshTokenProvider refreshTokenProvider, MfaTokenProvider mfaTokenProvider,
                       DemoTokenProvider demoTokenProvider, TotpService totpService,
                       BackupCodeService backupCodeService, TrustedDeviceService trustedDeviceService,
                       TokenDenyList tokenDenyList, DemoLimiter demoLimiter,
                       DemoSessionService demoSessionService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.userTokenProvider = userTokenProvider;
        this.refreshTokenProvider = refreshTokenProvider;
        this.mfaTokenProvider = mfaTokenProvider;
        this.demoTokenProvider = demoTokenProvider;
        this.totpService = totpService;
        this.backupCodeService = backupCodeService;
        this.trustedDeviceService = trustedDeviceService;
        this.tokenDenyList = tokenDenyList;
        this.demoLimiter = demoLimiter;
        this.demoSessionService = demoSessionService;
    }

    public LoginResult login(String username, String password, String mfaCode,
                             String deviceToken, String deviceFingerprint, boolean trustDevice) {
        Optional<UserDAO> userOpt = userRepository.findByUsername(username);

        if (userOpt.isEmpty()) {
            return new LoginResult.Failure("Invalid credentials");
        }

        UserDAO user = userOpt.get();

        if (!passwordEncoder.matches(password, user.getPassword())) {
            return new LoginResult.Failure("Invalid credentials");
        }

        if (user.isMfaEnabled()) {
            if (deviceToken != null && deviceFingerprint != null) {
                if (trustedDeviceService.isDeviceTrusted(deviceToken, deviceFingerprint)) {
                    return createAuthenticatedResponse(user, null);
                }
            }

            if (mfaCode == null || mfaCode.isEmpty()) {
                String mfaToken = mfaTokenProvider.generateToken(user.getId());
                return new LoginResult.MfaRequired(mfaToken, "MFA code required");
            }

            boolean authenticated = totpService.verifyCode(user.getMfaSecret(), mfaCode);
            if (!authenticated) {
                authenticated = backupCodeService.verifyAndUseBackupCode(user, mfaCode);
            }

            if (!authenticated) {
                return new LoginResult.Failure("Invalid MFA code");
            }

            String newDeviceToken = null;
            if (trustDevice && deviceFingerprint != null) {
                newDeviceToken = trustedDeviceService.createTrustedDevice(user, deviceFingerprint, "Browser");
            }

            return createAuthenticatedResponse(user, newDeviceToken);
        }

        return createAuthenticatedResponse(user, null);
    }

    private LoginResult createAuthenticatedResponse(UserDAO user, String deviceToken) {
        if (demoLimiter.isDemoMode() && !demoLimiter.isAllowedUser(user.getUsername())) {
            if (!demoSessionService.hasConsumedDemoLogin(user.getId())) {
                demoSessionService.recordFirstLogin(user.getId());
            } else if (demoSessionService.isDemoExpired(user.getId())) {
                return new LoginResult.DemoRateLimited(demoTokenProvider.generateToken(user.getId()));
            }
        }

        AuthSuccessResponse response = new AuthSuccessResponse(
                user.getUsername(),
                userTokenProvider.generateAccessToken(user.getId(), user.getUsername()),
                refreshTokenProvider.generateToken(user.getId(), user.getUsername(), userTokenProvider.getRefreshTokenExpMs()),
                user.isMfaEnabled(),
                deviceToken
        );
        return new LoginResult.Success(response);
    }

    @Transactional
    public LoginResult verifyMfa(String mfaToken, String code, String deviceFingerprint, boolean trustDevice) {
        return mfaTokenProvider.validateAndGetUserId(mfaToken)
                .flatMap(userRepository::findById)
                .map(user -> {
                    try {
                        boolean authenticated = totpService.verifyCode(user.getMfaSecret(), code);
                        if (!authenticated) {
                            authenticated = backupCodeService.verifyAndUseBackupCode(user, code);
                        }

                        if (!authenticated) {
                            return new LoginResult.Failure("Invalid MFA code");
                        }

                        String newDeviceToken = null;
                        if (trustDevice && deviceFingerprint != null) {
                            newDeviceToken = trustedDeviceService.createTrustedDevice(user, deviceFingerprint, "Browser");
                        }

                        return (LoginResult) createAuthenticatedResponse(user, newDeviceToken);
                    } catch (Exception e) {
                        return new LoginResult.Failure(e.getMessage() == null || e.getMessage().isBlank()
                                ? "Failed to verify MFA code"
                                : e.getMessage());
                    }
                })
                .orElse(new LoginResult.Failure("Invalid or expired MFA token"));
    }

    public RegisterResult register(String username, String password) {
        if (userRepository.findByUsername(username).isPresent()) {
            return new RegisterResult.UsernameTaken();
        }

        UserDAO user = userRepository.save(new UserDAO(
                username,
                passwordEncoder.encode(password),
                LocalDateTime.now(),
                false
        ));

        if (demoLimiter.isDemoMode() && !demoLimiter.isAllowedUser(username)) {
            demoSessionService.recordFirstLoginAt(user.getId(), getDemoSessionStartMillis(user));
        }

        AuthSuccessResponse response = new AuthSuccessResponse(
                user.getUsername(),
                userTokenProvider.generateAccessToken(user.getId(), user.getUsername()),
                refreshTokenProvider.generateToken(user.getId(), user.getUsername(), userTokenProvider.getRefreshTokenExpMs()),
                user.isMfaEnabled(),
                null
        );
        return new RegisterResult.Success(response);
    }

    @Transactional
    public AuthSuccessResponse upsertServiceUser(String username, String password) {
        String normalisedUsername = username.trim().toLowerCase(Locale.ROOT);
        UserDAO user = userRepository.findByUsername(normalisedUsername)
                .map(existing -> {
                    existing.setUsername(normalisedUsername);
                    existing.setPassword(passwordEncoder.encode(password));
                    existing.setMfaEnabled(false);
                    existing.setMfaSecret(null);
                    return userRepository.save(existing);
                })
                .orElseGet(() -> userRepository.save(new UserDAO(
                        normalisedUsername,
                        passwordEncoder.encode(password),
                        LocalDateTime.now(),
                        false
                )));

        LoginResult result = createAuthenticatedResponse(user, null);
        if (result instanceof LoginResult.Success success) {
            return success.response();
        }
        if (result instanceof LoginResult.DemoRateLimited demoRateLimited) {
            throw new IllegalStateException("Service user unexpectedly demo rate limited: " + demoRateLimited.demoToken());
        }
        throw new IllegalStateException("Unexpected service-user authentication state");
    }

    public Optional<LoginResult> refreshToken(String refreshToken) {
        if (tokenDenyList.isRevoked(refreshToken)) return Optional.of(ResponseFactory.expiredTokenResponse());
        return refreshTokenProvider.validateAndGetUserId(refreshToken)
                .flatMap(userRepository::findById)
                .map(user -> {
                    if (demoLimiter.isDemoMode() && !demoLimiter.isAllowedUser(user.getUsername())) {
                        if (!demoSessionService.hasConsumedDemoLogin(user.getId())) {
                            demoSessionService.recordFirstLoginAt(user.getId(), getDemoSessionStartMillis(user));
                        }

                        if (demoSessionService.isDemoExpired(user.getId())) {
                            return (LoginResult) new LoginResult.DemoRateLimited(demoTokenProvider.generateToken(user.getId()));
                        }
                    }
                    return ResponseFactory.loginResponse(
                            user.getUsername(),
                            userTokenProvider.generateAccessToken(user.getId(), user.getUsername()),
                            refreshTokenProvider.generateToken(user.getId(), user.getUsername(), userTokenProvider.getRefreshTokenExpMs()),
                            user.isMfaEnabled(),
                            null
                    );
                });
    }

    private long getDemoSessionStartMillis(UserDAO user) {
        LocalDateTime createdAt = user.getCreatedAt();
        if (createdAt == null) {
            return System.currentTimeMillis();
        }
        return createdAt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    @Transactional
    public Optional<UpdatePasswordResult> updatePassword(String token, UpdatePasswordRequest request) {
        Optional<UserDAO> userOpt = userTokenProvider.validateAndGetUserId(token)
                .flatMap(userRepository::findById);

        if (userOpt.isEmpty()) {
            return Optional.of(new UpdatePasswordResult.Failure("Invalid token"));
        }

        UserDAO user = userOpt.get();
        String mfaCode = request.mfaCode();

        if (user.isMfaEnabled()) {
            if (mfaCode == null || mfaCode.isEmpty()) {
                return Optional.of(new UpdatePasswordResult.MfaRequired("MFA code required for password update"));
            }

            boolean authenticated = totpService.verifyCode(user.getMfaSecret(), mfaCode);
            if (!authenticated) {
                authenticated = backupCodeService.verifyAndUseBackupCode(user, mfaCode);
            }

            if (!authenticated) {
                return Optional.of(new UpdatePasswordResult.Failure("Invalid MFA code"));
            }
        }

        if (!passwordEncoder.matches(request.oldPassword(), user.getPassword())) {
            return Optional.of(new UpdatePasswordResult.Failure("Old password is incorrect"));
        }

        user.setPassword(passwordEncoder.encode(request.newPassword()));
        userRepository.save(user);
        return Optional.of(new UpdatePasswordResult.Success("Password updated successfully"));
    }

    public Optional<UserDAO> getUserFromToken(String token) {
        return userTokenProvider.validateAndGetUserId(token)
                .flatMap(userRepository::findById);
    }

    @Transactional
    public Optional<String> verifyAndEnableMfa(String token, String code) {
        return userTokenProvider.validateAndGetUserId(token)
                .flatMap(userRepository::findById)
                .filter(user -> user.getMfaSecret() != null)
                .filter(user -> totpService.verifyCode(user.getMfaSecret(), code))
                .map(user -> {
                    user.setMfaEnabled(true);
                    userRepository.save(user);
                    return "MFA enabled successfully";
                });
    }

    @Transactional
    public Optional<String> disableMfa(String token, String code) {
        return userTokenProvider.validateAndGetUserId(token)
                .flatMap(userRepository::findById)
                .filter(UserDAO::isMfaEnabled)
                .filter(user -> totpService.verifyCode(user.getMfaSecret(), code))
                .map(user -> {
                    user.setMfaEnabled(false);
                    user.setMfaSecret(null);
                    backupCodeService.deleteBackupCodes(user);
                    userRepository.save(user);
                    return "MFA disabled successfully";
                });
    }

    @Transactional
    public Optional<MfaSetupResponse> setupMfa(String token) {
        return userTokenProvider.validateAndGetUserId(token)
                .flatMap(userRepository::findById)
                .flatMap(user -> {
                    if (user.isMfaEnabled()) {
                        return Optional.empty();
                    }

                    String secret;
                    List<String> backupCodes;

                    if (user.getMfaSecret() != null && !user.getMfaSecret().isEmpty()) {
                        secret = user.getMfaSecret();
                        backupCodes = List.of();
                    } else {
                        secret = totpService.generateSecret();
                        user.setMfaSecret(secret);
                        userRepository.save(user);
                        backupCodes = backupCodeService.generateAndSaveBackupCodes(user, 10);
                    }

                    return totpService.generateQrCodeDataUri(secret, user.getUsername())
                            .map(qrCode -> new MfaSetupResponse(secret, qrCode, backupCodes,
                                    "Scan the QR code with your authenticator app and save your backup codes"));
                });
    }

    private String createDeviceToken(String code, UserDAO user, boolean trustDevice, String deviceFingerprint) throws MfaValidationException {
        boolean authenticated = totpService.verifyCode(user.getMfaSecret(), code);
        if (!authenticated) {
            authenticated = backupCodeService.verifyAndUseBackupCode(user, code);
        }
        if (!authenticated) {
            throw new MfaValidationException("Invalid MFA code");
        }
        if (trustDevice && deviceFingerprint != null) {
            return trustedDeviceService.createTrustedDevice(user, deviceFingerprint, "Browser");
        }
        return "";
    }

    @Transactional
    public DeleteResult deleteUser(String token, String mfaCode) {
        Optional<UUID> userIdOpt = userTokenProvider.validateAndGetUserId(token);

        // Allow demo deletion tokens when in demo mode
        if (userIdOpt.isEmpty() && demoLimiter.isDemoMode()) {
            userIdOpt = demoTokenProvider.validateAndGetUserId(token);
        }

        Optional<UserDAO> userOpt = userIdOpt.flatMap(userRepository::findById);

        if (userOpt.isEmpty()) {
            return new DeleteResult.Failure("Invalid token");
        }

        UserDAO user = userOpt.get();

        // Skip MFA check when deleting via demo token - account is already expired
        boolean isDemoTokenDelete = demoLimiter.isDemoMode()
                && userTokenProvider.validateAndGetUserId(token).isEmpty();

        if (!isDemoTokenDelete && user.isMfaEnabled()) {
            if (mfaCode == null || mfaCode.isEmpty()) {
                return new DeleteResult.MfaRequired("MFA code required for account deletion");
            }

            boolean authenticated = totpService.verifyCode(user.getMfaSecret(), mfaCode);
            if (!authenticated) {
                authenticated = backupCodeService.verifyAndUseBackupCode(user, mfaCode);
            }

            if (!authenticated) {
                return new DeleteResult.Failure("Invalid MFA code");
            }
        }

        userRepository.delete(user);
        return new DeleteResult.Success("User deleted successfully");
    }

    public void logout(String accessToken, String refreshToken) {
        userTokenProvider.getRemainingExpiry(accessToken)
                .ifPresent(ms -> tokenDenyList.revoke(accessToken, ms));
        if (refreshToken != null && !refreshToken.isBlank()) {
            refreshTokenProvider.getRemainingExpiry(refreshToken)
                    .ifPresent(ms -> tokenDenyList.revoke(refreshToken, ms));
        }
    }

    public Optional<UserDAO> getUserById(UUID id) {
        return userRepository.findById(id);
    }

    public Optional<UserDAO> getUserFromDemoToken(String token) {
        return demoTokenProvider.validateAndGetUserId(token)
                .flatMap(userRepository::findById);
    }
}
