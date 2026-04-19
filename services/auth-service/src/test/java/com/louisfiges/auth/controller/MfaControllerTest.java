package com.louisfiges.auth.controller;

import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.service.TrustedDeviceService;
import com.louisfiges.auth.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
@DisplayName("MfaController Tests")
class MfaControllerTest {

    @Mock
    private UserService userService;

    @Mock
    private TrustedDeviceService trustedDeviceService;

    private MockMvc mockMvc;
    private UserDAO testUser;
    private UUID deviceId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new MfaController(userService, trustedDeviceService)).build();
        testUser = new UserDAO("testuser", "encoded", LocalDateTime.now(), false);
        deviceId = UUID.randomUUID();
    }

    @Test
    void revokeTrustedDeviceReturnsOkForOwnedDevice() throws Exception {
        when(userService.getUserFromToken("access-token")).thenReturn(Optional.of(testUser));
        when(trustedDeviceService.revokeTrustedDevice(testUser, deviceId)).thenReturn(true);

        mockMvc.perform(delete("/mfa/trusted-devices/{deviceId}", deviceId)
                        .header("Authorization", "Bearer access-token")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Device revoked"));

        verify(trustedDeviceService).revokeTrustedDevice(testUser, deviceId);
    }

    @Test
    void revokeTrustedDeviceReturnsNotFoundForForeignDevice() throws Exception {
        when(userService.getUserFromToken("access-token")).thenReturn(Optional.of(testUser));
        when(trustedDeviceService.revokeTrustedDevice(testUser, deviceId)).thenReturn(false);

        mockMvc.perform(delete("/mfa/trusted-devices/{deviceId}", deviceId)
                        .header("Authorization", "Bearer access-token"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.cause").value("Trusted device not found"));
    }

    @Test
    void revokeTrustedDeviceReturnsUnauthorizedForInvalidToken() throws Exception {
        when(userService.getUserFromToken(eq("invalid-token"))).thenReturn(Optional.empty());

        mockMvc.perform(delete("/mfa/trusted-devices/{deviceId}", deviceId)
                        .header("Authorization", "Bearer invalid-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.cause").value("Invalid token"));
    }
}
