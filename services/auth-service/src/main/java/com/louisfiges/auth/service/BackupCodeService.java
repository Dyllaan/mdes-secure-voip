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

    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O,0,I,1 confusion

    private String generateCode() {
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(8);
        for (int i = 0; i < 8; i++) {
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString(); // ~32^8 = 1 trillion combinations with numbers this is only 10^8
    }

    public List<String> generateAndSaveBackupCodes(UserDAO user, int count) {
        // Delete old codes first
        backupCodeRepository.deleteByUser(user);

        List<String> plainCodes = new ArrayList<>();

        for (int i = 0; i < count; i++) {
            // Generate a random 8-character code
            String code = generateCode();
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