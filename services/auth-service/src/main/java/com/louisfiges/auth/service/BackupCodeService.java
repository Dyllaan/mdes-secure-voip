package com.louisfiges.auth.service;

import com.louisfiges.auth.dao.BackupCodeDAO;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.repo.BackupCodeRepository;
import jakarta.transaction.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
public class BackupCodeService {

    @Autowired
    private BackupCodeRepository backupCodeRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    public List<String> generateAndSaveBackupCodes(UserDAO user, int count) {
        // Delete old codes first
        backupCodeRepository.deleteByUser(user);

        List<String> plainCodes = new ArrayList<>();
        SecureRandom random = new SecureRandom();

        for (int i = 0; i < count; i++) {
            // Generate 8-digit code
            String code = String.format("%08d", random.nextInt(100000000));
            plainCodes.add(code);

            // Store hashed version
            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setUser(user);
            backupCode.setCodeHash(passwordEncoder.encode(code));
            backupCode.setCreatedAt(LocalDateTime.now());

            backupCodeRepository.save(backupCode);
        }

        return plainCodes; // Return ONCE for user to save
    }

    public boolean verifyAndUseBackupCode(UserDAO user, String code) {
        List<BackupCodeDAO> codes = backupCodeRepository.findByUserAndUsedFalse(user);

        for (BackupCodeDAO backupCode : codes) {
            if (passwordEncoder.matches(code, backupCode.getCodeHash())) {
                backupCode.setUsed(true);
                backupCode.setUsedAt(LocalDateTime.now());
                backupCodeRepository.save(backupCode);
                return true;
            }
        }
        return false;
    }

    @Transactional
    public void deleteBackupCodes(UserDAO user) {
        backupCodeRepository.deleteByUser(user);
    }
}