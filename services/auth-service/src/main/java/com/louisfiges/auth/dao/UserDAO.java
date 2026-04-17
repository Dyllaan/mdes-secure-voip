package com.louisfiges.auth.dao;

import java.util.UUID;
import java.time.LocalDateTime;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Column;

@Entity
@Table(name = "users")
public class UserDAO {

    private @Id
    @GeneratedValue(strategy=GenerationType.AUTO) UUID id;

    @Column(nullable = false, unique = true)
    private String username;

    @Column(nullable = false)
    private String password;

    @Column(name="created_at")
    private LocalDateTime createdAt;

    @Column(name = "mfa_enabled")
    private Boolean mfaEnabled;

    @Column(name = "mfa_secret")
    private String mfaSecret;

    public UserDAO() {
    }
    
    // Getters and Setters

    public UserDAO (String username, String password, LocalDateTime createdAt, boolean mfaEnabled) {
        this.username = username;
        this.password = password;
        this.createdAt = createdAt;
        this.mfaEnabled = mfaEnabled;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public boolean isMfaEnabled() {
        return mfaEnabled != null ? mfaEnabled : false;
    }

    public void setMfaEnabled(boolean mfaEnabled) {
        this.mfaEnabled = mfaEnabled;
    }

    public String getMfaSecret() { return mfaSecret; }
    public void setMfaSecret(String mfaSecret) { this.mfaSecret = mfaSecret; }
}