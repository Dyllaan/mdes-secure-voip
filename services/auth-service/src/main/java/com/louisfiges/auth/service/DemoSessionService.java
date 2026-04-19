package com.louisfiges.auth.service;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class DemoSessionService {

    private static final String FIRST_LOGIN_PREFIX = "demo:first_login:";
    private static final String CONSUMED_LOGIN_PREFIX = "demo:consumed_login:";
    private static final String BAN_IP_PREFIX = "demo:banned:ip:";
    private static final String BAN_USERNAME_PREFIX = "demo:banned:username:";
    private static final long DEFAULT_DEMO_DURATION_MS = 1000L * 60 * 60 * 3;
    private static final String DEMO_DURATION_ENV = "DEMO_TIME_LIMIT_SECONDS";

    private final RedisTemplate<String, String> redisTemplate;
    private final long demoDurationMs;

    public DemoSessionService(RedisTemplate<String, String> redisTemplate) {
        this(redisTemplate, loadDemoDurationMs());
    }

    DemoSessionService(RedisTemplate<String, String> redisTemplate, long demoDurationMs) {
        this.redisTemplate = redisTemplate;
        this.demoDurationMs = demoDurationMs;
    }

    public void recordFirstLogin(UUID userId) {
        redisTemplate.opsForValue().setIfAbsent(
                FIRST_LOGIN_PREFIX + userId,
                String.valueOf(System.currentTimeMillis())
        );
        redisTemplate.opsForValue().setIfAbsent(CONSUMED_LOGIN_PREFIX + userId, "1");
    }

    public boolean hasConsumedDemoLogin(UUID userId) {
        return redisTemplate.hasKey(CONSUMED_LOGIN_PREFIX + userId);
    }

    public boolean isDemoExpired(UUID userId) {
        String value = redisTemplate.opsForValue().get(FIRST_LOGIN_PREFIX + userId);
        if (value == null) return false;
        return System.currentTimeMillis() > Long.parseLong(value) + demoDurationMs;
    }

    public void recordFirstLoginAt(UUID userId, long startedAtMs) {
        redisTemplate.opsForValue().setIfAbsent(
                FIRST_LOGIN_PREFIX + userId,
                String.valueOf(startedAtMs)
        );
        redisTemplate.opsForValue().setIfAbsent(CONSUMED_LOGIN_PREFIX + userId, "1");
    }

    public void banIpAndUsername(String ip, String username) {
        redisTemplate.opsForValue().set(BAN_IP_PREFIX + ip, "1");
        redisTemplate.opsForValue().set(BAN_USERNAME_PREFIX + username, "1");
    }

    public boolean isBanned(String ip, String username) {
        return redisTemplate.hasKey(BAN_IP_PREFIX + ip)
                || redisTemplate.hasKey(BAN_USERNAME_PREFIX + username);
    }

    private static long loadDemoDurationMs() {
        String raw = System.getenv(DEMO_DURATION_ENV);
        if (raw == null || raw.isBlank()) {
            return DEFAULT_DEMO_DURATION_MS;
        }

        try {
            long seconds = Long.parseLong(raw.trim());
            if (seconds <= 0) {
                return DEFAULT_DEMO_DURATION_MS;
            }
            return seconds * 1000L;
        } catch (NumberFormatException ignored) {
            return DEFAULT_DEMO_DURATION_MS;
        }
    }
}
