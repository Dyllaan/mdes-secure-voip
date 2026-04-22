package com.louisfiges.auth.integration;

import com.louisfiges.auth.config.DemoLimiter;
import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.http.RefreshTokenCookieFactory;
import com.louisfiges.auth.repo.UserRepository;
import com.louisfiges.auth.token.DemoTokenProvider;
import com.louisfiges.auth.token.MfaTokenProvider;
import com.louisfiges.auth.token.RefreshTokenProvider;
import com.louisfiges.auth.token.UserTokenProvider;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
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
import java.util.concurrent.TimeUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
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
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create");
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @MockitoBean
    private DemoLimiter demoLimiter;

    @MockitoBean
    private UserTokenProvider userTokenProvider;

    @MockitoBean
    private RefreshTokenProvider refreshTokenProvider;

    @MockitoBean
    private MfaTokenProvider mfaTokenProvider;

    @MockitoBean
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
        when(userTokenProvider.getRefreshTokenExpMs()).thenReturn(2_419_200_000L);
        when(refreshTokenProvider.generateToken(any(UUID.class), anyString(), anyLong()))
                .thenAnswer(invocation -> "refresh:" + invocation.getArgument(0, UUID.class));
        when(userTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "access:"));
        when(refreshTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "refresh:"));

        when(demoTokenProvider.generateToken(any(UUID.class)))
                .thenAnswer(invocation -> "demo:" + invocation.getArgument(0, UUID.class));
        when(demoTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "demo:"));

        when(mfaTokenProvider.generateToken(any(UUID.class)))
                .thenAnswer(invocation -> "mfa:" + invocation.getArgument(0, UUID.class));
        when(mfaTokenProvider.validateAndGetUserId(anyString()))
                .thenAnswer(invocation -> parseToken(invocation.getArgument(0, String.class), "mfa:"));
    }

    
    // Full lifecycle test (existing)
    

    @Test
    @DisplayName("Full demo lifecycle: register → login → expire → refresh blocked → delete via demo token")
    void demoLifecycleShouldExpireAndAllowDeletionViaDemoToken() {
        String username = "demo_it_user";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );

        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        assertThat(registerResponse.getBody()).containsKeys("accessToken", "username");
        assertThat(registerResponse.getBody()).doesNotContainKey("refreshToken");
        Assertions.assertNotNull(registerResponse.getBody());
        assertThat(registerResponse.getBody().get("username")).isEqualTo(username);

        HttpHeaders refreshHeaders = withRefreshCookie(extractRefreshCookie(registerResponse));

        ResponseEntity<Map<String, Object>> loginResponse = exchangeJson(
                "/user/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        assertThat(loginResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(loginResponse.getBody()).containsKeys("accessToken", "username");
        assertThat(loginResponse.getBody()).doesNotContainKey("refreshToken");

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        ResponseEntity<Map<String, Object>> refreshResponse = exchangeJson(
                "/user/refresh",
                HttpMethod.POST,
                new HttpEntity<>(refreshHeaders)
        );
        assertThat(refreshResponse.getStatusCode().value()).isEqualTo(403);
        assertThat(refreshResponse.getBody()).containsKeys("demoToken", "message");

        Assertions.assertNotNull(refreshResponse.getBody());
        String demoToken = (String) refreshResponse.getBody().get("demoToken");
        assertThat(demoToken).isEqualTo("demo:" + user.getId());

        HttpHeaders deleteHeaders = new HttpHeaders();
        deleteHeaders.setBearerAuth(demoToken);
        ResponseEntity<Map<String, Object>> deleteResponse = exchangeJson(
                "/user/delete",
                HttpMethod.DELETE,
                new HttpEntity<>(null, deleteHeaders)
        );
        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(deleteResponse.getBody()).containsEntry("message", "User deleted successfully");
        assertThat(userRepository.findByUsername(username)).isEmpty();
    }

    
    // Filter-level enforcement (new — this is the core fix)
    

    @Test
    @DisplayName("Filter must return 403 with demoToken when an active session's demo has expired")
    void filterShouldBlock_expiredDemoUser_onAuthenticatedApiCall() {
        String username = "demo_filter_user";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        Assertions.assertNotNull(registerResponse.getBody());
        String accessToken = (String) registerResponse.getBody().get("accessToken");

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<Map<String, Object>> meResponse = exchangeJson(
                "/user/me",
                HttpMethod.GET,
                new HttpEntity<>(null, headers)
        );

        assertThat(meResponse.getStatusCode().value()).isEqualTo(403);
        assertThat(meResponse.getBody()).containsKeys("demoToken", "message");
        Assertions.assertNotNull(meResponse.getBody());
        assertThat(meResponse.getBody().get("demoToken")).isEqualTo("demo:" + user.getId());
        assertThat((String) meResponse.getBody().get("message")).contains("expired");
    }

    @Test
    @DisplayName("Filter must not block an active, non-expired demo session")
    void filterShouldAllow_activeNonExpiredDemoUser() {
        String username = "demo_active_user";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        Assertions.assertNotNull(registerResponse.getBody());
        String accessToken = (String) registerResponse.getBody().get("accessToken");

        // 1 hour old, default limit is 3 hours — not expired
        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        long recentStart = System.currentTimeMillis() - TimeUnit.HOURS.toMillis(1);
        redisTemplate.opsForValue().set("demo:first_login:" + user.getId(), String.valueOf(recentStart));
        redisTemplate.opsForValue().set("demo:consumed_login:" + user.getId(), "1");

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<Map<String, Object>> meResponse = exchangeJson(
                "/user/me",
                HttpMethod.GET,
                new HttpEntity<>(null, headers)
        );

        assertThat(meResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(meResponse.getBody()).containsEntry("username", username);
    }

    @Test
    @DisplayName("Filter must not check demo expiry when DEMO_MODE is disabled")
    void filterShouldNotCheckDemo_whenDemoModeIsOff() {
        when(demoLimiter.isDemoMode()).thenReturn(false);

        String username = "non_demo_user";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        Assertions.assertNotNull(registerResponse.getBody());
        String accessToken = (String) registerResponse.getBody().get("accessToken");

        // Set Redis as expired — should have zero effect because DEMO_MODE is off
        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<Map<String, Object>> meResponse = exchangeJson(
                "/user/me",
                HttpMethod.GET,
                new HttpEntity<>(null, headers)
        );

        assertThat(meResponse.getStatusCode().value()).isEqualTo(200);
    }

    @Test
    @DisplayName("Allowed users must pass the filter even when their demo has expired")
    void filterShouldNotBlock_allowedUser_evenWhenDemoExpired() {
        String username = "allowed_admin";
        String password = "DemoPass123!";

        when(demoLimiter.isAllowedUser(username)).thenReturn(true);

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        Assertions.assertNotNull(registerResponse.getBody());
        String accessToken = (String) registerResponse.getBody().get("accessToken");

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<Map<String, Object>> meResponse = exchangeJson(
                "/user/me",
                HttpMethod.GET,
                new HttpEntity<>(null, headers)
        );

        assertThat(meResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(meResponse.getBody()).containsEntry("username", username);
    }

    
    // Logout must work even with an expired demo (tokens should be revocable)
    

    @Test
    @DisplayName("Logout must succeed even when the demo session has expired")
    void logoutShouldSucceed_whenDemoExpired() {
        String username = "demo_logout_user";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        assertThat(registerResponse.getStatusCode().value()).isEqualTo(201);
        Assertions.assertNotNull(registerResponse.getBody());
        String accessToken = (String) registerResponse.getBody().get("accessToken");
        String refreshCookie = extractRefreshCookie(registerResponse);

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<Map<String, Object>> logoutResponse = exchangeJson(
                "/user/logout",
                HttpMethod.POST,
                new HttpEntity<>(mergeHeaders(headers, withRefreshCookie(refreshCookie)))
        );

        assertThat(logoutResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(logoutResponse.getBody()).containsEntry("message", "Logged out successfully");
    }

    
    // Login and refresh blocking
    

    @Test
    @DisplayName("Login must return 403 with demoToken when demo is expired")
    void loginShouldReturn403_whenDemoExpired() {
        String username = "demo_login_blocked";
        String password = "DemoPass123!";

        exchangeJson("/user/register", HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password)));

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        ResponseEntity<Map<String, Object>> loginResponse = exchangeJson(
                "/user/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );

        assertThat(loginResponse.getStatusCode().value()).isEqualTo(403);
        assertThat(loginResponse.getBody()).containsKeys("demoToken", "message");
        Assertions.assertNotNull(loginResponse.getBody());
        assertThat(loginResponse.getBody().get("demoToken")).isEqualTo("demo:" + user.getId());
    }

    @Test
    @DisplayName("Refresh must return 403 with demoToken when demo is expired")
    void refreshShouldReturn403_whenDemoExpired() {
        String username = "demo_refresh_blocked";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register", HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        String refreshCookie = extractRefreshCookie(registerResponse);

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        ResponseEntity<Map<String, Object>> refreshResponse = exchangeJson(
                "/user/refresh", HttpMethod.POST,
                new HttpEntity<>(withRefreshCookie(refreshCookie))
        );

        assertThat(refreshResponse.getStatusCode().value()).isEqualTo(403);
        assertThat(refreshResponse.getBody()).containsKeys("demoToken", "message");
        Assertions.assertNotNull(refreshResponse.getBody());
        assertThat(refreshResponse.getBody().get("demoToken")).isEqualTo("demo:" + user.getId());
    }

    // Demo timer starts at registration, not first login
    @Test
    @DisplayName("Demo timer must start at registration, not at first login")
    void demoTimerShouldStartAtRegistration() {
        String username = "demo_timer_user";
        String password = "DemoPass123!";

        exchangeJson("/user/register", HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password)));

        UserDAO user = userRepository.findByUsername(username).orElseThrow();

        // The registration should have written the first_login key
        String firstLoginValue = redisTemplate.opsForValue().get("demo:first_login:" + user.getId());
        String consumedValue = redisTemplate.opsForValue().get("demo:consumed_login:" + user.getId());

        assertThat(firstLoginValue).isNotNull();
        assertThat(consumedValue).isEqualTo("1");

        // The recorded timestamp should be close to now (within 5 seconds)
        long recordedMs = Long.parseLong(firstLoginValue);
        assertThat(System.currentTimeMillis() - recordedMs).isLessThan(5_000L);
    }

    @Test
    @DisplayName("Redis timer must not be reset on repeated logins")
    void demoTimerMustNotReset_onRepeatedLogins() {
        String username = "demo_no_reset_user";
        String password = "DemoPass123!";

        exchangeJson("/user/register", HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password)));

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        String firstLoginValue = redisTemplate.opsForValue().get("demo:first_login:" + user.getId());
        assertThat(firstLoginValue).isNotNull();

        // Log in several more times
        for (int i = 0; i < 3; i++) {
            ResponseEntity<Map<String, Object>> loginResponse = exchangeJson(
                    "/user/login", HttpMethod.POST,
                    new HttpEntity<>(Map.of("username", username, "password", password))
            );
            assertThat(loginResponse.getStatusCode().value()).isEqualTo(200);
        }

        // Timer value must be unchanged
        String afterLoginsValue = redisTemplate.opsForValue().get("demo:first_login:" + user.getId());
        assertThat(afterLoginsValue).isEqualTo(firstLoginValue);
    }

    
    // Demo token allows account deletion, normal tokens do not
    

    @Test
    @DisplayName("Demo token must allow account deletion without MFA")
    void demoTokenShouldAllowAccountDeletion() {
        String username = "demo_delete_user";
        String password = "DemoPass123!";

        exchangeJson("/user/register", HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password)));

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        // Get a demo token via the refresh endpoint
        String refreshToken = "refresh:" + user.getId();
        ResponseEntity<Map<String, Object>> refreshResponse = exchangeJson(
                "/user/refresh", HttpMethod.POST,
                new HttpEntity<>(withRefreshCookie(refreshToken))
        );
        assertThat(refreshResponse.getStatusCode().value()).isEqualTo(403);
        Assertions.assertNotNull(refreshResponse.getBody());
        String demoToken = (String) refreshResponse.getBody().get("demoToken");

        // Delete with demo token — must succeed
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(demoToken);
        ResponseEntity<Map<String, Object>> deleteResponse = exchangeJson(
                "/user/delete", HttpMethod.DELETE,
                new HttpEntity<>(null, headers)
        );

        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(200);
        assertThat(userRepository.findByUsername(username)).isEmpty();
    }

    @Test
    @DisplayName("Normal access token must not be usable to delete an expired demo account")
    void normalTokenMustNotDeleteExpiredDemoAccount() {
        String username = "demo_no_normal_delete";
        String password = "DemoPass123!";

        ResponseEntity<Map<String, Object>> registerResponse = exchangeJson(
                "/user/register", HttpMethod.POST,
                new HttpEntity<>(Map.of("username", username, "password", password))
        );
        Assertions.assertNotNull(registerResponse.getBody());
        String accessToken = (String) registerResponse.getBody().get("accessToken");

        UserDAO user = userRepository.findByUsername(username).orElseThrow();
        expireDemoSession(user.getId());

        // Try to delete with the regular access token — filter must intercept with 403
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        ResponseEntity<Map<String, Object>> deleteResponse = exchangeJson(
                "/user/delete", HttpMethod.DELETE,
                new HttpEntity<>(null, headers)
        );

        // Filter returns 403 (demo expired) before the controller can process the delete
        assertThat(deleteResponse.getStatusCode().value()).isEqualTo(403);
        assertThat(deleteResponse.getBody()).containsKey("demoToken");
        // User must still exist — delete did not go through
        assertThat(userRepository.findByUsername(username)).isPresent();
    }

    
    // Helpers
    

    private void expireDemoSession(UUID userId) {
        long expiredStart = System.currentTimeMillis() - TimeUnit.HOURS.toMillis(4);
        redisTemplate.opsForValue().set("demo:first_login:" + userId, String.valueOf(expiredStart));
        redisTemplate.opsForValue().set("demo:consumed_login:" + userId, "1");
    }

    private ResponseEntity<Map<String, Object>> exchangeJson(String path, HttpMethod method, HttpEntity<?> request) {
        return restTemplate.exchange(
                path,
                method,
                request,
                new ParameterizedTypeReference<>() {}
        );
    }

    private String extractRefreshCookie(ResponseEntity<?> response) {
        String cookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        assertThat(cookie).isNotNull();
        assertThat(cookie).contains(RefreshTokenCookieFactory.COOKIE_NAME + "=");
        return cookie.substring(cookie.indexOf('=') + 1, cookie.indexOf(';'));
    }

    private HttpHeaders withRefreshCookie(String refreshToken) {
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.COOKIE, RefreshTokenCookieFactory.COOKIE_NAME + "=" + refreshToken);
        return headers;
    }

    private HttpHeaders mergeHeaders(HttpHeaders... headerSets) {
        HttpHeaders merged = new HttpHeaders();
        for (HttpHeaders headerSet : headerSets) {
            merged.putAll(headerSet);
        }
        return merged;
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
