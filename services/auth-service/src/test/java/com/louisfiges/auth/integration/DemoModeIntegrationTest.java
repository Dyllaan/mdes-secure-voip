package com.louisfiges.auth.integration;

import com.louisfiges.auth.config.DemoLimiter;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.repo.UserRepository;
import com.louisfiges.auth.token.DemoTokenProvider;
import com.louisfiges.auth.token.MfaTokenProvider;
import com.louisfiges.auth.token.UserTokenProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers(disabledWithoutDocker = true)
@SuppressWarnings("removal")
class DemoModeIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("auth_test")
            .withUsername("test")
            .withPassword("test");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @MockBean
    private DemoLimiter demoLimiter;

    @MockBean
    private UserTokenProvider userTokenProvider;

    @MockBean
    private MfaTokenProvider mfaTokenProvider;

    @MockBean
    private DemoTokenProvider demoTokenProvider;

    @BeforeEach
    void resetState() {
        userRepository.deleteAll();

        RedisConnection connection = Objects.requireNonNull(redisTemplate.getConnectionFactory()).getConnection();
        try {
            connection.serverCommands().flushAll();
        } finally {
            connection.close();
        }

        when(demoLimiter.isDemoMode()).thenReturn(true);
        when(demoLimiter.isAllowedUser(anyString())).thenReturn(false);

        when(userTokenProvider.generateAccessToken(any(UUID.class), anyString()))
                .thenAnswer(invocation -> "access:" + invocation.getArgument(0, UUID.class));
        when(userTokenProvider.generateRefreshToken(any(UUID.class), anyString()))
                .thenAnswer(invocation -> "refresh:" + invocation.getArgument(0, UUID.class));
        when(userTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "access:", "refresh:"));

        when(demoTokenProvider.generateToken(any(UUID.class)))
                .thenAnswer(invocation -> "demo:" + invocation.getArgument(0, UUID.class));
        when(demoTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "demo:"));

        when(mfaTokenProvider.generateToken(any(UUID.class)))
                .thenAnswer(invocation -> "mfa:" + invocation.getArgument(0, UUID.class));
        when(mfaTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "mfa:"));
    }

    @Test
    @DisplayName("Demo mode should allow registration and login, then expire on refresh and delete by demo token")
    void demoLifecycleShouldExpireAndAllowDeletionViaDemoToken() {
        String username = "demo_it_user";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );

        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        assertThat(registerResponse.getBody()).containsKeys("accessToken", "refreshToken", "username");
        assertThat(registerResponse.getBody().get("username")).isEqualTo(username);

        String refreshToken = (String) registerResponse.getBody().get("refreshToken");

        ResponseEntity<Map<String, Object>> loginResponse = exchangeJson(
                "/user/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );

        assertThat(loginResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(loginResponse.getBody()).containsKeys("accessToken", "refreshToken", "username");

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        UUID userId = user.getId();

        redisTemplate.opsForValue().set("demo:first_login:" + userId, String.valueOf(System.currentTimeMillis() - 60_000));
        redisTemplate.opsForValue().set("demo:consumed_login:" + userId, "1");

        ResponseEntity<Map<String, Object>> refreshResponse = exchangeJson(
                "/user/refresh",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("refreshToken", refreshToken))
        );

        assertThat(refreshResponse.getStatusCode().value()).isEqualTo(403);
        assertThat(refreshResponse.getBody()).containsKeys("demoToken", "message");

        String demoToken = (String) refreshResponse.getBody().get("demoToken");

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(demoToken);

        ResponseEntity<Map<String, Object>> deleteResponse = exchangeJson(
                "/user/delete",
                HttpMethod.DELETE,
                new HttpEntity<>(null, headers)
        );

        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(deleteResponse.getBody()).containsEntry("message", "User deleted successfully");
        assertThat(userRepository.findByUsername(username)).isEmpty();
    }

    private ResponseEntity<Map<String, Object>> exchangeJson(String path, HttpMethod method, HttpEntity<?> request) {
        return restTemplate.exchange(
                path,
                method,
                request,
                new ParameterizedTypeReference<>() {
                }
        );
    }

    private Optional<UUID> parseToken(String token, String... prefixes) {
        for (String prefix : prefixes) {
            if (token != null && token.startsWith(prefix)) {
                return Optional.of(UUID.fromString(token.substring(prefix.length())));
            }
        }
        return Optional.empty();
    }
}
