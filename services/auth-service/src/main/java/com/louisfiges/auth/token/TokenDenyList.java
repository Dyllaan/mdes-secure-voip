package com.louisfiges.auth.token;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
public class TokenDenyList {

    private final RedisTemplate<String, String> redisTemplate;

    public TokenDenyList(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void revoke(String token, long expiryMillis) {
        redisTemplate.opsForValue().set("revoked:" + token, "1", expiryMillis, TimeUnit.MILLISECONDS);
    }

    public boolean isRevoked(String token) {
        return redisTemplate.hasKey("revoked:" + token);
    }
}