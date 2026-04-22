package com.louisfiges.auth.token;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.concurrent.TimeUnit;

@Component
public class TokenDenyList {

    private final RedisTemplate<String, String> redisTemplate;

    public TokenDenyList(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void revoke(String token, long expiryMillis) {
        redisTemplate.opsForValue().set("revoked:" + hash(token), "1", expiryMillis, TimeUnit.MILLISECONDS);
    }

    public boolean isRevoked(String token) {
        return redisTemplate.hasKey("revoked:" + hash(token));
    }

    private String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}