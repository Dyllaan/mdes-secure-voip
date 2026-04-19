package com.louisfiges.auth.config;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ApplicationPropertiesTest {

    @Test
    void baseApplicationPropertiesUseProductionSafeDefaults() throws IOException {
        Properties properties = load("application.properties");

        assertEquals("INFO", properties.getProperty("logging.level.org.springframework.security"));
        assertEquals("INFO", properties.getProperty("logging.level.org.springframework.web"));
        assertEquals("INFO", properties.getProperty("logging.level.org.hibernate"));
        assertEquals("never", properties.getProperty("server.error.include-message"));
        assertEquals("never", properties.getProperty("server.error.include-stacktrace"));
        assertEquals("false", properties.getProperty("server.error.include-exception"));
    }

    @Test
    void localProfileRestoresVerboseDebugging() throws IOException {
        Properties properties = load("application-local.properties");

        assertEquals("DEBUG", properties.getProperty("logging.level.org.springframework.security"));
        assertEquals("DEBUG", properties.getProperty("logging.level.org.springframework.web"));
        assertEquals("DEBUG", properties.getProperty("logging.level.org.hibernate"));
        assertEquals("always", properties.getProperty("server.error.include-message"));
        assertEquals("always", properties.getProperty("server.error.include-stacktrace"));
        assertEquals("true", properties.getProperty("server.error.include-exception"));
    }

    private Properties load(String resourceName) throws IOException {
        Properties properties = new Properties();
        try (InputStream inputStream = getClass().getClassLoader().getResourceAsStream(resourceName)) {
            if (inputStream == null) {
                throw new IOException("Missing resource: " + resourceName);
            }
            properties.load(inputStream);
        }
        return properties;
    }
}
