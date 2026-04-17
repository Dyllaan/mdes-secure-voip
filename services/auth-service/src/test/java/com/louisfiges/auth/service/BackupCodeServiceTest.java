package com.louisfiges.auth.service;

import com.louisfiges.auth.dao.BackupCodeDAO;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.repo.BackupCodeRepository;
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
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("BackupCodeService Tests")
class BackupCodeServiceTest {

    @Mock
    private BackupCodeRepository backupCodeRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @InjectMocks
    private BackupCodeService backupCodeService;

    @Captor
    private ArgumentCaptor<BackupCodeDAO> backupCodeCaptor;

    private UserDAO testUser;
    private static final UUID USER_ID = UUID.fromString("123e4567-e89b-12d3-a456-426614174000");
    private static final String USERNAME = "testuser";
    private static final String ENCODED_PASSWORD = "encoded_password";

    @BeforeEach
    void setUp() {
        testUser = new UserDAO(USERNAME, ENCODED_PASSWORD, LocalDateTime.now(), false);
        testUser.setId(USER_ID);
    }

    @Nested
    @DisplayName("Generate and Save Backup Codes Tests")
    class GenerateAndSaveBackupCodesTests {

        @Test
        @DisplayName("Should generate correct number of backup codes")
        void shouldGenerateCorrectNumberOfCodes() {
            int codeCount = 10;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");

            List<String> codes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);

            assertThat(codes).hasSize(codeCount);
            verify(backupCodeRepository, times(codeCount)).save(any(BackupCodeDAO.class));
        }

        @Test
        @DisplayName("Should generate 8-digit codes")
        void shouldGenerate8DigitCodes() {
            int codeCount = 5;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");

            List<String> codes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);


            assertThat(codes).allMatch(code -> code.length() == 8);
            assertThat(codes).allMatch(code -> code.matches("\\d{8}"));
        }

        @Test
        @DisplayName("Should generate unique codes")
        void shouldGenerateUniqueCodes() {

            int codeCount = 10;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");

            List<String> codes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);

            long uniqueCount = codes.stream().distinct().count();
            assertThat(uniqueCount).isEqualTo(codeCount);
        }

        @Test
        @DisplayName("Should delete old codes before generating new ones")
        void shouldDeleteOldCodesFirst() {

            int codeCount = 5;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");


            backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);


            verify(backupCodeRepository).deleteByUser(testUser);
        }

        @Test
        @DisplayName("Should save hashed codes to repository")
        void shouldSaveHashedCodes() {

            int codeCount = 3;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code_1", "hashed_code_2", "hashed_code_3");


            List<String> plainCodes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);


            verify(backupCodeRepository, times(codeCount)).save(backupCodeCaptor.capture());
            List<BackupCodeDAO> savedCodes = backupCodeCaptor.getAllValues();

            assertThat(savedCodes).hasSize(codeCount);
            assertThat(savedCodes).allMatch(code -> code.getUser().equals(testUser));
            assertThat(savedCodes).allMatch(code -> code.getCreatedAt() != null);
            assertThat(savedCodes).allMatch(code -> !code.isUsed());

            for (String plainCode : plainCodes) {
                verify(passwordEncoder).encode(plainCode);
            }
        }

        @Test
        @DisplayName("Should save codes with proper initialization")
        void shouldSaveCodesWithProperInitialization() {

            int codeCount = 1;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");


            backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);


            verify(backupCodeRepository).save(backupCodeCaptor.capture());
            BackupCodeDAO savedCode = backupCodeCaptor.getValue();

            assertThat(savedCode.getUser()).isEqualTo(testUser);
            assertThat(savedCode.getCodeHash()).isEqualTo("hashed_code");
            assertThat(savedCode.getCreatedAt()).isNotNull();
            assertThat(savedCode.getCreatedAt()).isBefore(LocalDateTime.now().plusSeconds(1));
            assertThat(savedCode.isUsed()).isFalse();
            assertThat(savedCode.getUsedAt()).isNull();
        }

        @Test
        @DisplayName("Should generate zero codes when count is zero")
        void shouldGenerateZeroCodesWhenCountIsZero() {

            int codeCount = 0;


            List<String> codes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);


            assertThat(codes).isEmpty();
            verify(backupCodeRepository).deleteByUser(testUser);
            verify(backupCodeRepository, never()).save(any(BackupCodeDAO.class));
        }

        @Test
        @DisplayName("Should handle single code generation")
        void shouldHandleSingleCodeGeneration() {

            int codeCount = 1;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");


            List<String> codes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);


            assertThat(codes).hasSize(1);
            assertThat(codes.get(0)).matches("\\d{8}");
            verify(backupCodeRepository, times(1)).save(any(BackupCodeDAO.class));
        }

        @Test
        @DisplayName("Should pad codes with leading zeros")
        void shouldPadCodesWithLeadingZeros() {
            int codeCount = 100;
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");

            List<String> codes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);

            assertThat(codes).allMatch(code -> code.length() == 8);
            assertThat(codes).allMatch(code -> code.matches("^\\d{8}$"));
        }
    }

    @Nested
    @DisplayName("Verify and Use Backup Code Tests")
    class VerifyAndUseBackupCodeTests {

        @Test
        @DisplayName("Should verify and mark code as used with valid code")
        void shouldVerifyAndUseValidCode() {
            String plainCode = "12345678";
            String hashedCode = "hashed_12345678";

            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setId(1);
            backupCode.setUser(testUser);
            backupCode.setCodeHash(hashedCode);
            backupCode.setUsed(false);
            backupCode.setCreatedAt(LocalDateTime.now());

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode));
            when(passwordEncoder.matches(plainCode, hashedCode)).thenReturn(true);

            boolean result = backupCodeService.verifyAndUseBackupCode(testUser, plainCode);

            assertThat(result).isTrue();
            verify(passwordEncoder).matches(plainCode, hashedCode);
            verify(backupCodeRepository).save(backupCodeCaptor.capture());

            BackupCodeDAO savedCode = backupCodeCaptor.getValue();
            assertThat(savedCode.isUsed()).isTrue();
            assertThat(savedCode.getUsedAt()).isNotNull();
            assertThat(savedCode.getUsedAt()).isBefore(LocalDateTime.now().plusSeconds(1));
        }

        @Test
        @DisplayName("Should return false with invalid code")
        void shouldReturnFalseWithInvalidCode() {

            String plainCode = "12345678";
            String hashedCode = "hashed_87654321";

            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setId(1);
            backupCode.setUser(testUser);
            backupCode.setCodeHash(hashedCode);
            backupCode.setUsed(false);

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode));
            when(passwordEncoder.matches(plainCode, hashedCode)).thenReturn(false);

            boolean result = backupCodeService.verifyAndUseBackupCode(testUser, plainCode);

            assertThat(result).isFalse();
            verify(backupCodeRepository, never()).save(any(BackupCodeDAO.class));
        }

        @Test
        @DisplayName("Should return false when no unused codes exist")
        void shouldReturnFalseWhenNoUnusedCodes() {
            String plainCode = "12345678";
            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of());

            boolean result = backupCodeService.verifyAndUseBackupCode(testUser, plainCode);

            assertThat(result).isFalse();
            verify(passwordEncoder, never()).matches(anyString(), anyString());
            verify(backupCodeRepository, never()).save(any(BackupCodeDAO.class));
        }

        @Test
        @DisplayName("Should verify first matching code in list")
        void shouldVerifyFirstMatchingCode() {
            String plainCode = "12345678";

            BackupCodeDAO backupCode1 = new BackupCodeDAO();
            backupCode1.setId(1);
            backupCode1.setUser(testUser);
            backupCode1.setCodeHash("hashed_wrong");
            backupCode1.setUsed(false);

            BackupCodeDAO backupCode2 = new BackupCodeDAO();
            backupCode2.setId(2);
            backupCode2.setUser(testUser);
            backupCode2.setCodeHash("hashed_correct");
            backupCode2.setUsed(false);

            BackupCodeDAO backupCode3 = new BackupCodeDAO();
            backupCode3.setId(3);
            backupCode3.setUser(testUser);
            backupCode3.setCodeHash("hashed_also_correct");
            backupCode3.setUsed(false);

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode1, backupCode2, backupCode3));
            when(passwordEncoder.matches(plainCode, "hashed_wrong")).thenReturn(false);
            when(passwordEncoder.matches(plainCode, "hashed_correct")).thenReturn(true);


            boolean result = backupCodeService.verifyAndUseBackupCode(testUser, plainCode);

            assertThat(result).isTrue();
            verify(backupCodeRepository).save(backupCode2); // Only the matching code is saved
            verify(backupCodeRepository, times(1)).save(any(BackupCodeDAO.class));
            assertThat(backupCode2.isUsed()).isTrue();
        }

        @Test
        @DisplayName("Should not verify already used codes")
        void shouldNotVerifyAlreadyUsedCodes() {
            String plainCode = "12345678";

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of());

            boolean result = backupCodeService.verifyAndUseBackupCode(testUser, plainCode);

            assertThat(result).isFalse();
            verify(backupCodeRepository).findByUserAndUsedFalse(testUser);
        }

        @Test
        @DisplayName("Should handle multiple verification attempts")
        void shouldHandleMultipleVerificationAttempts() {
            String correctCode = "12345678";
            String wrongCode1 = "11111111";
            String wrongCode2 = "22222222";

            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setId(1);
            backupCode.setUser(testUser);
            backupCode.setCodeHash("hashed_12345678");
            backupCode.setUsed(false);

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode));
            when(passwordEncoder.matches(wrongCode1, "hashed_12345678")).thenReturn(false);
            when(passwordEncoder.matches(wrongCode2, "hashed_12345678")).thenReturn(false);
            when(passwordEncoder.matches(correctCode, "hashed_12345678")).thenReturn(true);


            boolean result1 = backupCodeService.verifyAndUseBackupCode(testUser, wrongCode1);
            boolean result2 = backupCodeService.verifyAndUseBackupCode(testUser, wrongCode2);
            boolean result3 = backupCodeService.verifyAndUseBackupCode(testUser, correctCode);

            assertThat(result1).isFalse();
            assertThat(result2).isFalse();
            assertThat(result3).isTrue();
            verify(backupCodeRepository, times(1)).save(any(BackupCodeDAO.class));
        }

        @Test
        @DisplayName("Should set usedAt timestamp when marking code as used")
        void shouldSetUsedAtTimestamp() {

            String plainCode = "12345678";
            LocalDateTime beforeTest = LocalDateTime.now();

            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setId(1);
            backupCode.setUser(testUser);
            backupCode.setCodeHash("hashed_code");
            backupCode.setUsed(false);

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode));
            when(passwordEncoder.matches(plainCode, "hashed_code")).thenReturn(true);

            backupCodeService.verifyAndUseBackupCode(testUser, plainCode);

            LocalDateTime afterTest = LocalDateTime.now();
            assertThat(backupCode.getUsedAt()).isNotNull();
            assertThat(backupCode.getUsedAt()).isAfterOrEqualTo(beforeTest);
            assertThat(backupCode.getUsedAt()).isBeforeOrEqualTo(afterTest);
        }

        @Test
        @DisplayName("Should handle empty code string")
        void shouldHandleEmptyCodeString() {
            String emptyCode = "";

            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setId(1);
            backupCode.setUser(testUser);
            backupCode.setCodeHash("hashed_code");
            backupCode.setUsed(false);

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode));
            when(passwordEncoder.matches(emptyCode, "hashed_code")).thenReturn(false);

            boolean result = backupCodeService.verifyAndUseBackupCode(testUser, emptyCode);

            assertThat(result).isFalse();
        }
    }

    @Nested
    @DisplayName("Delete Backup Codes Tests")
    class DeleteBackupCodesTests {

        @Test
        @DisplayName("Should delete all backup codes for user")
        void shouldDeleteAllBackupCodesForUser() {
            backupCodeService.deleteBackupCodes(testUser);

            verify(backupCodeRepository).deleteByUser(testUser);
        }

        @Test
        @DisplayName("Should call delete only once")
        void shouldCallDeleteOnlyOnce() {
            backupCodeService.deleteBackupCodes(testUser);

            verify(backupCodeRepository, times(1)).deleteByUser(testUser);
        }

        @Test
        @DisplayName("Should be transactional")
        void shouldBeTransactional() throws NoSuchMethodException {
            var method = BackupCodeService.class.getMethod("deleteBackupCodes", UserDAO.class);

            assertThat(method.isAnnotationPresent(jakarta.transaction.Transactional.class)).isTrue();
        }
    }

    @Nested
    @DisplayName("Integration Scenario Tests")
    class IntegrationScenarioTests {

        @Test
        @DisplayName("Should handle full lifecycle - generate, verify, delete")
        void shouldHandleFullLifecycle() {
            int codeCount = 10;
            when(passwordEncoder.encode(anyString())).thenAnswer(invocation ->
                    "hashed_" + invocation.getArgument(0));

            List<String> generatedCodes = backupCodeService.generateAndSaveBackupCodes(testUser, codeCount);
            assertThat(generatedCodes).hasSize(codeCount);

            String codeToVerify = generatedCodes.get(0);
            BackupCodeDAO backupCode = new BackupCodeDAO();
            backupCode.setCodeHash("hashed_" + codeToVerify);
            backupCode.setUser(testUser);
            backupCode.setUsed(false);

            when(backupCodeRepository.findByUserAndUsedFalse(testUser))
                    .thenReturn(List.of(backupCode));
            when(passwordEncoder.matches(codeToVerify, "hashed_" + codeToVerify))
                    .thenReturn(true);

            boolean verified = backupCodeService.verifyAndUseBackupCode(testUser, codeToVerify);
            assertThat(verified).isTrue();

            backupCodeService.deleteBackupCodes(testUser);
            verify(backupCodeRepository, times(2)).deleteByUser(testUser); // Once during generation, once at end
        }

        @Test
        @DisplayName("Should regenerate codes after using all backup codes")
        void shouldRegenerateCodesAfterUsingAll() {
            when(passwordEncoder.encode(anyString())).thenReturn("hashed_code");
            List<String> firstBatch = backupCodeService.generateAndSaveBackupCodes(testUser, 5);

            List<String> secondBatch = backupCodeService.generateAndSaveBackupCodes(testUser, 5);

            verify(backupCodeRepository, times(2)).deleteByUser(testUser);
            assertThat(firstBatch).hasSize(5);
            assertThat(secondBatch).hasSize(5);
        }
    }
}