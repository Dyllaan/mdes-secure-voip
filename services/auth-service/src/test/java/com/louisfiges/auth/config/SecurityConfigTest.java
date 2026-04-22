package com.louisfiges.auth.config;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SecurityConfigTest {

    @Test
    void corsConfigurationUsesConfiguredOriginAllowlist() {
        SecurityConfig securityConfig = new SecurityConfig("http://localhost:3000,electron://app");
        CorsConfigurationSource source = securityConfig.corsConfigurationSource();

        MockHttpServletRequest allowedRequest = new MockHttpServletRequest();
        allowedRequest.setRequestURI("/user/login");
        allowedRequest.addHeader("Origin", "http://localhost:3000");

        MockHttpServletRequest deniedRequest = new MockHttpServletRequest();
        deniedRequest.setRequestURI("/user/login");
        deniedRequest.addHeader("Origin", "https://evil.example");

        CorsConfiguration allowedConfig = source.getCorsConfiguration(allowedRequest);
        CorsConfiguration deniedConfig = source.getCorsConfiguration(deniedRequest);

        Assertions.assertNotNull(allowedConfig);
        assertEquals("http://localhost:3000", allowedConfig.checkOrigin("http://localhost:3000"));
        Assertions.assertNotNull(deniedConfig);
        assertNull(deniedConfig.checkOrigin("https://evil.example"));
        assertEquals(Boolean.TRUE, allowedConfig.getAllowCredentials());
        Assertions.assertNotNull(allowedConfig.getAllowedOrigins());
        assertFalse(allowedConfig.getAllowedOrigins().contains("*"));
    }
}
