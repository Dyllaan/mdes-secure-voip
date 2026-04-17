package com.louisfiges.auth.repo;

import com.louisfiges.auth.dao.TrustedDeviceDAO;
import com.louisfiges.auth.dao.UserDAO;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TrustedDeviceRepository extends JpaRepository<TrustedDeviceDAO, UUID> {
    Optional<TrustedDeviceDAO> findByDeviceTokenAndExpiresAtAfter(String deviceToken, LocalDateTime now);
    List<TrustedDeviceDAO> findByUser(UserDAO user);
    void deleteByExpiresAtBefore(LocalDateTime now); // Cleanup expired devices
    void deleteByUser(UserDAO user); // When disabling MFA
}