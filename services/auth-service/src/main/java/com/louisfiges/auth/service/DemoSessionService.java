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
    private static final long DEMO_DURATION_MS = 1000L * 60 * 60 * 3;

    private final RedisTemplate<String, String> redisTemplate;

    public DemoSessionService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
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
        return System.currentTimeMillis() > Long.parseLong(value) + DEMO_DURATION_MS;
    }

    public void banIpAndUsername(String ip, String username) {
        redisTemplate.opsForValue().set(BAN_IP_PREFIX + ip, "1");
        redisTemplate.opsForValue().set(BAN_USERNAME_PREFIX + username, "1");
    }

    public boolean isBanned(String ip, String username) {
        return redisTemplate.hasKey(BAN_IP_PREFIX + ip)
                || redisTemplate.hasKey(BAN_USERNAME_PREFIX + username);
    }
}
