package com.louisfiges.auth.controller;

import com.louisfiges.auth.dao.TrustedDeviceDAO;
import com.louisfiges.auth.dto.mfa.request.MfaVerifyRequest;
import com.louisfiges.auth.dto.mfa.response.MfaStatusResponse;
import com.louisfiges.auth.http.ResponseFactory;
import com.louisfiges.auth.service.TrustedDeviceService;
import com.louisfiges.auth.service.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/mfa")
public class MfaController {

    private final UserService userService;
    private final TrustedDeviceService trustedDeviceService;
    private static final org.slf4j.Logger logger = org.slf4j.LoggerFactory.getLogger(MfaController.class);

    public MfaController(UserService userService, TrustedDeviceService trustedDeviceService) {
        this.userService = userService;
        this.trustedDeviceService = trustedDeviceService;
    }

    @PostMapping("/setup")
    public ResponseEntity<?> setupMfa(@RequestHeader(value = "Authorization", required = false) String token) {
        if (token == null || token.isEmpty()) {
            return ResponseEntity.status(401)
                    .body(ResponseFactory.error("Authorization header is required"));
        }

        if (!token.startsWith("Bearer ")) {
            logger.warn("Invalid Authorization header format");
            return ResponseEntity.status(401)
                    .body(ResponseFactory.error("Authorization header must start with 'Bearer '"));
        }

        try {
            return userService.setupMfa(token.substring(7))  // Call UserService method
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.badRequest()
                            .body(ResponseFactory.mfaInvalid("MFA already enabled or invalid token")));
        } catch (Exception e) {
            logger.error("Error during MFA setup", e);
            return ResponseEntity.internalServerError()
                    .body(ResponseFactory.mfaInvalid("Failed to generate QR code: "));
        }
    }

    @PostMapping("/verify")
    public ResponseEntity<?> verifyMfa(@RequestHeader("Authorization") String token,
                                       @RequestBody MfaVerifyRequest request) {
        return userService.verifyAndEnableMfa(token.replace("Bearer ", ""), request.code())
                .<ResponseEntity<?>>map(message -> ResponseEntity.ok(ResponseFactory.mfaInvalid(message)))
                .orElseGet(() -> ResponseEntity.badRequest()
                        .body(ResponseFactory.mfaInvalid("Invalid MFA code")));
    }

    @PostMapping("/disable")
    public ResponseEntity<?> disableMfa(@RequestHeader("Authorization") String token,
                                        @RequestBody MfaVerifyRequest request) {
        return userService.disableMfa(token.replace("Bearer ", ""), request.code())
                .<ResponseEntity<?>>map(message -> ResponseEntity.ok(ResponseFactory.mfaInvalid(message)))
                .orElseGet(() -> ResponseEntity.badRequest()
                        .body(ResponseFactory.mfaInvalid("Invalid MFA code or MFA not enabled")));
    }

    @GetMapping("/status")
    public ResponseEntity<?> getMfaStatus(@RequestHeader("Authorization") String token) {
        return userService.getUserFromToken(token.replace("Bearer ", ""))
                .<ResponseEntity<?>>map(user ->
                        ResponseEntity.ok(new MfaStatusResponse(user.isMfaEnabled()))
                )
                .orElseGet(() -> ResponseEntity.status(401)
                        .body(ResponseFactory.error("Invalid token")));
    }

    // In MfaController
    @GetMapping({"/trusted-devices", "/mfa/trusted-devices"})
    public ResponseEntity<?> getTrustedDevices(@RequestHeader("Authorization") String token) {
        return userService.getUserFromToken(token.replace("Bearer ", ""))
                .map(user -> {
                    List<TrustedDeviceDAO> devices = trustedDeviceService.getUserTrustedDevices(user);
                    return ResponseEntity.ok(devices.stream()
                            .map(d -> Map.of(
                                    "id", d.getId(),
                                    "deviceName", d.getDeviceName(),
                                    "lastUsedAt", d.getLastUsedAt(),
                                    "createdAt", d.getCreatedAt()
                            ))
                            .toList());
                })
                .orElse(ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }

    @DeleteMapping({"/trusted-devices/{deviceId}", "/mfa/trusted-devices/{deviceId}"})
    public ResponseEntity<?> revokeTrustedDevice(
            @RequestHeader("Authorization") String token,
            @PathVariable UUID deviceId) {
        return userService.getUserFromToken(token.replace("Bearer ", ""))
                .map(user -> trustedDeviceService.revokeTrustedDevice(user, deviceId)
                        ? ResponseEntity.ok(Map.of("message", "Device revoked"))
                        : ResponseEntity.status(HttpStatus.NOT_FOUND).body(ResponseFactory.error("Trusted device not found")))
                .orElse(ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ResponseFactory.error("Invalid token")));
    }

    @DeleteMapping({"/trusted-devices", "/mfa/trusted-devices"})
    public ResponseEntity<?> revokeAllTrustedDevices(@RequestHeader("Authorization") String token) {
        return userService.getUserFromToken(token.replace("Bearer ", ""))
                .map(user -> {
                    trustedDeviceService.revokeAllTrustedDevices(user);
                    return ResponseEntity.ok(Map.of("message", "All devices revoked"));
                })
                .orElse(ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }
}
