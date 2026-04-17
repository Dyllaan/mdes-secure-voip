package com.louisfiges.auth.service;

import com.louisfiges.auth.dao.TrustedDeviceDAO;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.repo.TrustedDeviceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class TrustedDeviceService {
    private static final int DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS = 30;

    private final TrustedDeviceRepository trustedDeviceRepository;
    private final int deviceTokenValidityDays;

    public TrustedDeviceService(TrustedDeviceRepository trustedDeviceRepository) {
        this.trustedDeviceRepository = trustedDeviceRepository;
        this.deviceTokenValidityDays = getTrustedDeviceValidityDays();
    }

    @Transactional
    public String createTrustedDevice(UserDAO user, String deviceFingerprint, String deviceName) {
        String deviceToken = generateDeviceToken();
        LocalDateTime expiresAt = LocalDateTime.now().plusDays(deviceTokenValidityDays);

        TrustedDeviceDAO device = new TrustedDeviceDAO(
                user,
                deviceToken,
                deviceFingerprint,
                deviceName,
                expiresAt
        );

        trustedDeviceRepository.save(device);
        return deviceToken;
    }

    public boolean isDeviceTrusted(String deviceToken, String deviceFingerprint) {
        return trustedDeviceRepository.findByDeviceTokenAndExpiresAtAfter(deviceToken, LocalDateTime.now())
                .filter(device -> device.getDeviceFingerprint().equals(deviceFingerprint))
                .map(device -> {
                    // Update last used
                    device.setLastUsedAt(LocalDateTime.now());
                    trustedDeviceRepository.save(device);
                    return true;
                })
                .orElse(false);
    }

    @Transactional
    public List<TrustedDeviceDAO> getUserTrustedDevices(UserDAO user) {
        return trustedDeviceRepository.findByUser(user);
    }

    @Transactional
    public void revokeTrustedDevice(UUID deviceId) {
        trustedDeviceRepository.deleteById(deviceId);
    }

    @Transactional
    public void revokeAllTrustedDevices(UserDAO user) {
        trustedDeviceRepository.deleteByUser(user);
    }

    @Transactional
    public void cleanupExpiredDevices() {
        trustedDeviceRepository.deleteByExpiresAtBefore(LocalDateTime.now());
    }

    private String generateDeviceToken() {
        SecureRandom random = new SecureRandom();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private int getTrustedDeviceValidityDays() {
        String raw = System.getenv("TRUSTED_DEVICE_VALIDITY_DAYS");
        if (raw == null || raw.isBlank()) {
            return DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS;
        }

        try {
            int days = Integer.parseInt(raw.trim());
            return days > 0 ? days : DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS;
        } catch (NumberFormatException e) {
            return DEFAULT_DEVICE_TOKEN_VALIDITY_DAYS;
        }
    }
}
