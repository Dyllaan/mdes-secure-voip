package com.louisfiges.auth.constants;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class PublicPathsTest {

    @Test
    void botLoginEndpointIsPublic() {
        assertTrue(PublicPaths.isPublicPath("/user/bot-login"));
    }
}
