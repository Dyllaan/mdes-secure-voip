package com.louisfiges.auth.repo;


import com.louisfiges.auth.dao.BackupCodeDAO;
import com.louisfiges.auth.dao.UserDAO;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BackupCodeRepository extends JpaRepository<BackupCodeDAO, Long> {
    List<BackupCodeDAO> findByUserAndUsedFalse(UserDAO user);
    void deleteByUser(UserDAO user);
}