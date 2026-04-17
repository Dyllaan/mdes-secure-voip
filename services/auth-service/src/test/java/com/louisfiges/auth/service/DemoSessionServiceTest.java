package com.louisfiges.auth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("DemoSessionService Tests")
class DemoSessionServiceTest {

    @Mock
    private RedisTemplate<String, String> redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    private DemoSessionService demoSessionService;

    private static final UUID USER_ID = UUID.fromString("123e4567-e89b-12d3-a456-426614174000");

    @BeforeEach
    void setUp() {
        demoSessionService = new DemoSessionService(redisTemplate);
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    @DisplayName("Should report demo login as not consumed initially")
    void shouldReportDemoLoginAsNotConsumedInitially() {
        when(redisTemplate.hasKey("demo:consumed_login:" + USER_ID)).thenReturn(false);

        boolean consumed = demoSessionService.hasConsumedDemoLogin(USER_ID);

        assertThat(consumed).isFalse();
    }

    @Test
    @DisplayName("Should mark demo login as consumed after first login is recorded")
    void shouldMarkDemoLoginAsConsumedAfterFirstLoginRecorded() {
        when(redisTemplate.hasKey("demo:consumed_login:" + USER_ID)).thenReturn(true);

        demoSessionService.recordFirstLogin(USER_ID);

        assertThat(demoSessionService.hasConsumedDemoLogin(USER_ID)).isTrue();
        verify(valueOperations).setIfAbsent(eq("demo:first_login:" + USER_ID), anyString());
        verify(valueOperations).setIfAbsent("demo:consumed_login:" + USER_ID, "1");
    }

    @Test
    @DisplayName("Should keep demo login consumed after repeated record calls")
    void shouldKeepDemoLoginConsumedAfterRepeatedRecordCalls() {
        when(redisTemplate.hasKey("demo:consumed_login:" + USER_ID)).thenReturn(true);

        demoSessionService.recordFirstLogin(USER_ID);
        demoSessionService.recordFirstLogin(USER_ID);

        assertThat(demoSessionService.hasConsumedDemoLogin(USER_ID)).isTrue();
        verify(valueOperations, times(2)).setIfAbsent("demo:consumed_login:" + USER_ID, "1");
    }

    @Test
    @DisplayName("Should report banned when IP or username has been banned")
    void shouldReportBannedWhenIpOrUsernameHasBeenBanned() {
        when(redisTemplate.hasKey("demo:banned:ip:127.0.0.1")).thenReturn(true);

        boolean banned = demoSessionService.isBanned("127.0.0.1", "testuser");

        assertThat(banned).isTrue();
    }

    @Test
    @DisplayName("Should persist IP and username bans")
    void shouldPersistIpAndUsernameBans() {
        demoSessionService.banIpAndUsername("127.0.0.1", "testuser");

        verify(valueOperations).set("demo:banned:ip:127.0.0.1", "1");
        verify(valueOperations).set("demo:banned:username:testuser", "1");
    }
}
