package com.louisfiges.auth.service;

import com.bastiaanjansen.otp.HMACAlgorithm;
import com.bastiaanjansen.otp.SecretGenerator;
import com.bastiaanjansen.otp.TOTPGenerator;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import org.apache.commons.codec.binary.Base32;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.Base64;
import java.util.Optional;

@Service
public class TotpService {

    public String generateSecret() {
        return new Base32().encodeToString(SecretGenerator.generate());
    }

    public Optional<String> generateQrCodeDataUri(String secret, String username) {
        try {
            URI uri = buildGenerator(secret).getURI("Dedicate", username);
            BitMatrix matrix = new QRCodeWriter().encode(uri.toString(), BarcodeFormat.QR_CODE, 200, 200);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(matrix, "PNG", out);
            return Optional.of("data:image/png;base64," + Base64.getEncoder().encodeToString(out.toByteArray()));
        } catch (WriterException | IOException | URISyntaxException e) {
            return Optional.empty();
        }
    }

    public boolean verifyCode(String secret, String code) {
        return buildGenerator(secret).verify(code);
    }

    private TOTPGenerator buildGenerator(String secret) {
        byte[] secretBytes = new Base32().decode(secret);
        return new TOTPGenerator.Builder(secretBytes)
                .withHOTPGenerator(b -> {
                    b.withPasswordLength(6);
                    b.withAlgorithm(HMACAlgorithm.SHA256);
                })
                .withPeriod(Duration.ofSeconds(30))
                .build();
    }
}