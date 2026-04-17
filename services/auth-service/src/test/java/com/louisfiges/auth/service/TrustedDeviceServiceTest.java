package com.louisfiges.auth.service;

import com.louisfiges.auth.dao.TrustedDeviceDAO;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.repo.TrustedDeviceRepository;
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

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("TrustedDeviceService Tests")
class TrustedDeviceServiceTest {

    @Mock
    private TrustedDeviceRepository trustedDeviceRepository;

    @InjectMocks
    private TrustedDeviceService trustedDeviceService;

    @Captor
    private ArgumentCaptor<TrustedDeviceDAO> deviceCaptor;

    private UserDAO testUser;
    private static final UUID USER_ID = UUID.fromString("123e4567-e89b-12d3-a456-426614174000");
    private static final UUID DEVICE_ID = UUID.fromString("223e4567-e89b-12d3-a456-426614174000");
    private static final String USERNAME = "testuser";
    private static final String ENCODED_PASSWORD = "encoded_password";
    private static final String DEVICE_FINGERPRINT = "chrome-windows-192.168.1.1";
    private static final String DEVICE_NAME = "Chrome on Windows";
    private static final int DEVICE_TOKEN_VALIDITY_DAYS = 30;

    @BeforeEach
    void setUp() {
        testUser = new UserDAO(USERNAME, ENCODED_PASSWORD, LocalDateTime.now(), false);
        testUser.setId(USER_ID);
    }

    @Nested
    @DisplayName("Create Trusted Device Tests")
    class CreateTrustedDeviceTests {

        @Test
        @DisplayName("Should create trusted device with valid parameters")
        void shouldCreateTrustedDevice() {
            // Given
            LocalDateTime beforeTest = LocalDateTime.now();

            // When
            String deviceToken = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);

            // Then
            assertThat(deviceToken).isNotNull();
            assertThat(deviceToken).isNotEmpty();

            verify(trustedDeviceRepository).save(deviceCaptor.capture());
            TrustedDeviceDAO savedDevice = deviceCaptor.getValue();

            assertThat(savedDevice.getUser()).isEqualTo(testUser);
            assertThat(savedDevice.getDeviceToken()).isEqualTo(deviceToken);
            assertThat(savedDevice.getDeviceFingerprint()).isEqualTo(DEVICE_FINGERPRINT);
            assertThat(savedDevice.getDeviceName()).isEqualTo(DEVICE_NAME);
            assertThat(savedDevice.getCreatedAt()).isNotNull();
            assertThat(savedDevice.getLastUsedAt()).isNotNull();
            assertThat(savedDevice.getExpiresAt()).isNotNull();
            assertThat(savedDevice.getExpiresAt()).isAfter(beforeTest.plusDays(DEVICE_TOKEN_VALIDITY_DAYS - 1));
        }

        @Test
        @DisplayName("Should generate URL-safe device token")
        void shouldGenerateUrlSafeDeviceToken() {
            // When
            String deviceToken = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);

            // Then
            assertThat(deviceToken).matches("^[A-Za-z0-9_-]+$"); // URL-safe Base64
            assertThat(deviceToken).doesNotContain("+", "/", "="); // No standard Base64 chars
        }

        @Test
        @DisplayName("Should generate unique device tokens")
        void shouldGenerateUniqueDeviceTokens() {
            // When
            String token1 = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);
            String token2 = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);
            String token3 = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);

            // Then
            assertThat(token1).isNotEqualTo(token2);
            assertThat(token2).isNotEqualTo(token3);
            assertThat(token1).isNotEqualTo(token3);
        }

        @Test
        @DisplayName("Should set expiration to 30 days from now")
        void shouldSetExpirationTo30Days() {
            // Given
            LocalDateTime beforeTest = LocalDateTime.now();

            // When
            trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);

            // Then
            LocalDateTime afterTest = LocalDateTime.now();
            verify(trustedDeviceRepository).save(deviceCaptor.capture());
            TrustedDeviceDAO savedDevice = deviceCaptor.getValue();

            LocalDateTime expectedExpiration = beforeTest.plusDays(DEVICE_TOKEN_VALIDITY_DAYS);
            assertThat(savedDevice.getExpiresAt()).isAfterOrEqualTo(expectedExpiration);
            assertThat(savedDevice.getExpiresAt()).isBefore(afterTest.plusDays(DEVICE_TOKEN_VALIDITY_DAYS).plusSeconds(1));
        }

        @Test
        @DisplayName("Should set createdAt and lastUsedAt to current time")
        void shouldSetTimestampsToNow() {
            // Given
            LocalDateTime beforeTest = LocalDateTime.now();

            // When
            trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);

            // Then
            LocalDateTime afterTest = LocalDateTime.now();
            verify(trustedDeviceRepository).save(deviceCaptor.capture());
            TrustedDeviceDAO savedDevice = deviceCaptor.getValue();

            assertThat(savedDevice.getCreatedAt()).isAfterOrEqualTo(beforeTest);
            assertThat(savedDevice.getCreatedAt()).isBeforeOrEqualTo(afterTest);
            assertThat(savedDevice.getLastUsedAt()).isAfterOrEqualTo(beforeTest);
            assertThat(savedDevice.getLastUsedAt()).isBeforeOrEqualTo(afterTest);
        }

        @Test
        @DisplayName("Should be transactional")
        void shouldBeTransactional() throws NoSuchMethodException {
            // Given
            var method = TrustedDeviceService.class.getMethod("createTrustedDevice", UserDAO.class, String.class, String.class);

            // Then
            assertThat(method.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class)).isTrue();
        }

        @Test
        @DisplayName("Should generate token with proper length")
        void shouldGenerateTokenWithProperLength() {
            // When
            String deviceToken = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);

            // Then
            // 32 bytes encoded in Base64 without padding should be 43 characters
            assertThat(deviceToken.length()).isEqualTo(43);
        }

        @Test
        @DisplayName("Should handle different device names")
        void shouldHandleDifferentDeviceNames() {
            // When
            String token1 = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Firefox on Mac");
            String token2 = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, "Safari on iPhone");

            // Then
            verify(trustedDeviceRepository, times(2)).save(deviceCaptor.capture());
            List<TrustedDeviceDAO> savedDevices = deviceCaptor.getAllValues();

            assertThat(savedDevices.get(0).getDeviceName()).isEqualTo("Firefox on Mac");
            assertThat(savedDevices.get(1).getDeviceName()).isEqualTo("Safari on iPhone");
        }
    }

    @Nested
    @DisplayName("Is Device Trusted Tests")
    class IsDeviceTrustedTests {

        @Test
        @DisplayName("Should return true for valid trusted device")
        void shouldReturnTrueForValidDevice() {
            // Given
            String deviceToken = "valid_token";
            LocalDateTime futureExpiry = LocalDateTime.now().plusDays(10);

            TrustedDeviceDAO device = new TrustedDeviceDAO(
                    testUser,
                    deviceToken,
                    DEVICE_FINGERPRINT,
                    DEVICE_NAME,
                    futureExpiry
            );

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.of(device));

            // When
            boolean isTrusted = trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);

            // Then
            assertThat(isTrusted).isTrue();
            verify(trustedDeviceRepository).save(deviceCaptor.capture());
            TrustedDeviceDAO updatedDevice = deviceCaptor.getValue();
            assertThat(updatedDevice.getLastUsedAt()).isNotNull();
        }

        @Test
        @DisplayName("Should return false for expired device")
        void shouldReturnFalseForExpiredDevice() {
            // Given
            String deviceToken = "expired_token";

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.empty());

            // When
            boolean isTrusted = trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);

            // Then
            assertThat(isTrusted).isFalse();
            verify(trustedDeviceRepository, never()).save(any());
        }

        @Test
        @DisplayName("Should return false for non-existent device")
        void shouldReturnFalseForNonExistentDevice() {
            // Given
            String deviceToken = "non_existent_token";

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.empty());

            // When
            boolean isTrusted = trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);

            // Then
            assertThat(isTrusted).isFalse();
        }

        @Test
        @DisplayName("Should return false for mismatched fingerprint")
        void shouldReturnFalseForMismatchedFingerprint() {
            // Given
            String deviceToken = "valid_token";
            String wrongFingerprint = "different-fingerprint";
            LocalDateTime futureExpiry = LocalDateTime.now().plusDays(10);

            TrustedDeviceDAO device = new TrustedDeviceDAO(
                    testUser,
                    deviceToken,
                    DEVICE_FINGERPRINT,
                    DEVICE_NAME,
                    futureExpiry
            );

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.of(device));

            // When
            boolean isTrusted = trustedDeviceService.isDeviceTrusted(deviceToken, wrongFingerprint);

            // Then
            assertThat(isTrusted).isFalse();
            verify(trustedDeviceRepository, never()).save(any());
        }

        @Test
        @DisplayName("Should update lastUsedAt when device is trusted")
        void shouldUpdateLastUsedAtWhenDeviceTrusted() {
            // Given
            String deviceToken = "valid_token";
            LocalDateTime futureExpiry = LocalDateTime.now().plusDays(10);
            LocalDateTime beforeTest = LocalDateTime.now();

            TrustedDeviceDAO device = new TrustedDeviceDAO(
                    testUser,
                    deviceToken,
                    DEVICE_FINGERPRINT,
                    DEVICE_NAME,
                    futureExpiry
            );

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.of(device));

            // When
            trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);

            // Then
            LocalDateTime afterTest = LocalDateTime.now();
            verify(trustedDeviceRepository).save(deviceCaptor.capture());
            TrustedDeviceDAO updatedDevice = deviceCaptor.getValue();

            assertThat(updatedDevice.getLastUsedAt()).isAfterOrEqualTo(beforeTest);
            assertThat(updatedDevice.getLastUsedAt()).isBeforeOrEqualTo(afterTest);
        }

        @Test
        @DisplayName("Should query repository with current time for expiration check")
        void shouldQueryWithCurrentTimeForExpiration() {
            // Given
            String deviceToken = "valid_token";
            LocalDateTime beforeTest = LocalDateTime.now();

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.empty());

            // When
            trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);

            // Then
            LocalDateTime afterTest = LocalDateTime.now();
            verify(trustedDeviceRepository).findByDeviceTokenAndExpiresAtAfter(
                    eq(deviceToken),
                    argThat(time -> !time.isBefore(beforeTest) && !time.isAfter(afterTest))
            );
        }

        @Test
        @DisplayName("Should handle null fingerprint gracefully")
        void shouldHandleNullFingerprintGracefully() {
            // Given
            String deviceToken = "valid_token";
            LocalDateTime futureExpiry = LocalDateTime.now().plusDays(10);

            TrustedDeviceDAO device = new TrustedDeviceDAO(
                    testUser,
                    deviceToken,
                    DEVICE_FINGERPRINT,
                    DEVICE_NAME,
                    futureExpiry
            );

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.of(device));

            // When
            boolean isTrusted = trustedDeviceService.isDeviceTrusted(deviceToken, null);

            // Then
            assertThat(isTrusted).isFalse();
            verify(trustedDeviceRepository, never()).save(any());
        }
    }

    @Nested
    @DisplayName("Get User Trusted Devices Tests")
    class GetUserTrustedDevicesTests {

        @Test
        @DisplayName("Should return all trusted devices for user")
        void shouldReturnAllTrustedDevicesForUser() {
            // Given
            TrustedDeviceDAO device1 = new TrustedDeviceDAO(
                    testUser, "token1", "fingerprint1", "Device 1", LocalDateTime.now().plusDays(30)
            );
            TrustedDeviceDAO device2 = new TrustedDeviceDAO(
                    testUser, "token2", "fingerprint2", "Device 2", LocalDateTime.now().plusDays(30)
            );

            when(trustedDeviceRepository.findByUser(testUser))
                    .thenReturn(List.of(device1, device2));

            // When
            List<TrustedDeviceDAO> devices = trustedDeviceService.getUserTrustedDevices(testUser);

            // Then
            assertThat(devices).hasSize(2);
            assertThat(devices).contains(device1, device2);
            verify(trustedDeviceRepository).findByUser(testUser);
        }

        @Test
        @DisplayName("Should return empty list when user has no devices")
        void shouldReturnEmptyListWhenNoDevices() {
            // Given
            when(trustedDeviceRepository.findByUser(testUser))
                    .thenReturn(List.of());

            // When
            List<TrustedDeviceDAO> devices = trustedDeviceService.getUserTrustedDevices(testUser);

            // Then
            assertThat(devices).isEmpty();
        }

        @Test
        @DisplayName("Should be transactional")
        void shouldBeTransactional() throws NoSuchMethodException {
            // Given
            var method = TrustedDeviceService.class.getMethod("getUserTrustedDevices", UserDAO.class);

            // Then
            assertThat(method.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class)).isTrue();
        }
    }

    @Nested
    @DisplayName("Revoke Trusted Device Tests")
    class RevokeTrustedDeviceTests {

        @Test
        @DisplayName("Should revoke trusted device by ID")
        void shouldRevokeTrustedDeviceById() {
            // When
            trustedDeviceService.revokeTrustedDevice(DEVICE_ID);

            // Then
            verify(trustedDeviceRepository).deleteById(DEVICE_ID);
        }

        @Test
        @DisplayName("Should call delete exactly once")
        void shouldCallDeleteExactlyOnce() {
            // When
            trustedDeviceService.revokeTrustedDevice(DEVICE_ID);

            // Then
            verify(trustedDeviceRepository, times(1)).deleteById(DEVICE_ID);
        }

        @Test
        @DisplayName("Should be transactional")
        void shouldBeTransactional() throws NoSuchMethodException {
            // Given
            var method = TrustedDeviceService.class.getMethod("revokeTrustedDevice", UUID.class);

            // Then
            assertThat(method.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class)).isTrue();
        }

        @Test
        @DisplayName("Should handle different device IDs")
        void shouldHandleDifferentDeviceIds() {
            // Given
            UUID deviceId1 = UUID.randomUUID();
            UUID deviceId2 = UUID.randomUUID();

            // When
            trustedDeviceService.revokeTrustedDevice(deviceId1);
            trustedDeviceService.revokeTrustedDevice(deviceId2);

            // Then
            verify(trustedDeviceRepository).deleteById(deviceId1);
            verify(trustedDeviceRepository).deleteById(deviceId2);
        }
    }

    @Nested
    @DisplayName("Revoke All Trusted Devices Tests")
    class RevokeAllTrustedDevicesTests {

        @Test
        @DisplayName("Should revoke all trusted devices for user")
        void shouldRevokeAllTrustedDevicesForUser() {
            // When
            trustedDeviceService.revokeAllTrustedDevices(testUser);

            // Then
            verify(trustedDeviceRepository).deleteByUser(testUser);
        }

        @Test
        @DisplayName("Should call delete by user exactly once")
        void shouldCallDeleteByUserExactlyOnce() {
            // When
            trustedDeviceService.revokeAllTrustedDevices(testUser);

            // Then
            verify(trustedDeviceRepository, times(1)).deleteByUser(testUser);
        }

        @Test
        @DisplayName("Should be transactional")
        void shouldBeTransactional() throws NoSuchMethodException {
            // Given
            var method = TrustedDeviceService.class.getMethod("revokeAllTrustedDevices", UserDAO.class);

            // Then
            assertThat(method.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class)).isTrue();
        }
    }

    @Nested
    @DisplayName("Cleanup Expired Devices Tests")
    class CleanupExpiredDevicesTests {

        @Test
        @DisplayName("Should cleanup expired devices")
        void shouldCleanupExpiredDevices() {
            // Given
            LocalDateTime beforeTest = LocalDateTime.now();

            // When
            trustedDeviceService.cleanupExpiredDevices();

            // Then
            LocalDateTime afterTest = LocalDateTime.now();
            verify(trustedDeviceRepository).deleteByExpiresAtBefore(
                    argThat(time -> !time.isBefore(beforeTest) && !time.isAfter(afterTest))
            );
        }

        @Test
        @DisplayName("Should call cleanup exactly once")
        void shouldCallCleanupExactlyOnce() {
            // When
            trustedDeviceService.cleanupExpiredDevices();

            // Then
            verify(trustedDeviceRepository, times(1)).deleteByExpiresAtBefore(any(LocalDateTime.class));
        }

        @Test
        @DisplayName("Should be transactional")
        void shouldBeTransactional() throws NoSuchMethodException {
            // Given
            var method = TrustedDeviceService.class.getMethod("cleanupExpiredDevices");

            // Then
            assertThat(method.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class)).isTrue();
        }

        @Test
        @DisplayName("Should use current time for deletion")
        void shouldUseCurrentTimeForDeletion() {
            // Given
            LocalDateTime now = LocalDateTime.now();

            // When
            trustedDeviceService.cleanupExpiredDevices();

            // Then
            verify(trustedDeviceRepository).deleteByExpiresAtBefore(
                    argThat(time -> !time.isBefore(now.minusSeconds(1)))
            );
        }
    }

    @Nested
    @DisplayName("Integration Scenario Tests")
    class IntegrationScenarioTests {

        @Test
        @DisplayName("Should handle full device lifecycle - create, verify, revoke")
        void shouldHandleFullDeviceLifecycle() {
            // Given - Create device
            String deviceToken = trustedDeviceService.createTrustedDevice(testUser, DEVICE_FINGERPRINT, DEVICE_NAME);
            assertThat(deviceToken).isNotNull();

            verify(trustedDeviceRepository).save(deviceCaptor.capture());
            TrustedDeviceDAO savedDevice = deviceCaptor.getValue();

            // When - Verify device
            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.of(savedDevice));

            boolean isTrusted = trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);
            assertThat(isTrusted).isTrue();

            // Then - Revoke device
            trustedDeviceService.revokeTrustedDevice(DEVICE_ID);
            verify(trustedDeviceRepository).deleteById(DEVICE_ID);
        }

        @Test
        @DisplayName("Should handle multiple devices for same user")
        void shouldHandleMultipleDevicesForSameUser() {
            // When
            String token1 = trustedDeviceService.createTrustedDevice(testUser, "fingerprint1", "Device 1");
            String token2 = trustedDeviceService.createTrustedDevice(testUser, "fingerprint2", "Device 2");
            String token3 = trustedDeviceService.createTrustedDevice(testUser, "fingerprint3", "Device 3");

            // Then
            assertThat(token1).isNotEqualTo(token2);
            assertThat(token2).isNotEqualTo(token3);
            verify(trustedDeviceRepository, times(3)).save(any(TrustedDeviceDAO.class));
        }

        @Test
        @DisplayName("Should update last used on repeated verification")
        void shouldUpdateLastUsedOnRepeatedVerification() {
            // Given
            String deviceToken = "valid_token";
            LocalDateTime futureExpiry = LocalDateTime.now().plusDays(10);

            TrustedDeviceDAO device = new TrustedDeviceDAO(
                    testUser,
                    deviceToken,
                    DEVICE_FINGERPRINT,
                    DEVICE_NAME,
                    futureExpiry
            );

            when(trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(eq(deviceToken), any(LocalDateTime.class)))
                    .thenReturn(Optional.of(device));

            // When - Verify multiple times
            trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);
            trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);
            trustedDeviceService.isDeviceTrusted(deviceToken, DEVICE_FINGERPRINT);

            // Then
            verify(trustedDeviceRepository, times(3)).save(any(TrustedDeviceDAO.class));
        }

        @Test
        @DisplayName("Should revoke all devices and verify cleanup")
        void shouldRevokeAllDevicesAndVerifyCleanup() {
            // Given - Create multiple devices
            trustedDeviceService.createTrustedDevice(testUser, "fingerprint1", "Device 1");
            trustedDeviceService.createTrustedDevice(testUser, "fingerprint2", "Device 2");

            // When - Revoke all
            trustedDeviceService.revokeAllTrustedDevices(testUser);

            // Then
            verify(trustedDeviceRepository).deleteByUser(testUser);
        }
    }
}