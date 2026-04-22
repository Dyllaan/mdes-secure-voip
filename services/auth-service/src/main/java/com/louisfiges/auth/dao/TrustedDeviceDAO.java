package com.louisfiges.auth.dao;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "trusted_devices")
public class TrustedDeviceDAO {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private UserDAO user;

    @Column(name = "device_token", nullable = false, unique = true)
    private String deviceToken;

    @Column(name = "device_fingerprint", nullable = false)
    private String deviceFingerprint; // Browser + OS + IP hash

    @Column(name = "device_name")
    private String deviceName; // e.g., "Chrome on Windows"

    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    // Constructors, getters, setters
    public TrustedDeviceDAO() {}

    public TrustedDeviceDAO(UserDAO user, String deviceToken, String deviceFingerprint,
                            String deviceName, LocalDateTime expiresAt) {
        this.user = user;
        this.deviceToken = deviceToken;
        this.deviceFingerprint = deviceFingerprint;
        this.deviceName = deviceName;
        this.createdAt = LocalDateTime.now();
        this.lastUsedAt = LocalDateTime.now();
        this.expiresAt = expiresAt;
    }

    public UUID getId() {
        return id;
    }

    public UserDAO getUser() {
        return user;
    }

    public String getDeviceToken() {
        return deviceToken;
    }

    public String getDeviceFingerprint() {
        return deviceFingerprint;
    }

    public String getDeviceName() {
        return deviceName;
    }

    public LocalDateTime getLastUsedAt() {
        return lastUsedAt;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setLastUsedAt(LocalDateTime lastUsedAt) {
        this.lastUsedAt = lastUsedAt;
    }
}