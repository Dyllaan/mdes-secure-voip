package com.louisfiges.auth.dao;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "backup_code")  // Changed from "backup_codes" to match Hibernate's expected name
public class BackupCodeDAO {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private UserDAO user;

    @Column(name = "code_hash", nullable = false)
    private String codeHash;

    @Column(nullable = false)
    private boolean used = false;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;

    // Constructors
    public BackupCodeDAO() {}

    public BackupCodeDAO(UserDAO user, String codeHash, LocalDateTime createdAt) {
        this.user = user;
        this.codeHash = codeHash;
        this.createdAt = createdAt;
    }

    // Getters and setters
    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }

    public UserDAO getUser() { return user; }
    public void setUser(UserDAO user) { this.user = user; }

    public String getCodeHash() { return codeHash; }
    public void setCodeHash(String codeHash) { this.codeHash = codeHash; }

    public boolean isUsed() { return used; }
    public void setUsed(boolean used) { this.used = used; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUsedAt() { return usedAt; }
    public void setUsedAt(LocalDateTime usedAt) { this.usedAt = usedAt; }
}