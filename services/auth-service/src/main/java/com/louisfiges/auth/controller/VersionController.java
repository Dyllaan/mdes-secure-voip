package com.louisfiges.auth.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/version")
public class VersionController {

    @Autowired(required = false)
    private BuildProperties buildProperties;

    @GetMapping
    public Map<String, String> getVersion() {
        if (buildProperties != null) {
            return Map.of(
                    "version", buildProperties.getVersion(),
                    "name", buildProperties.getName(),
                    "time", buildProperties.getTime().toString()
            );
        }
        return Map.of("version", "unknown");
    }
}