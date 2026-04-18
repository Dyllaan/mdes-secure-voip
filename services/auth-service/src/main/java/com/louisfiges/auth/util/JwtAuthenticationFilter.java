package com.louisfiges.auth.util;

import com.louisfiges.auth.config.DemoLimiter;
import com.louisfiges.auth.constants.PublicPaths;
import com.louisfiges.auth.token.DemoTokenProvider;
import com.louisfiges.auth.token.TokenDenyList;
import com.louisfiges.auth.token.UserTokenProvider;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.lang.NonNull;

import com.louisfiges.auth.service.UserService;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final UserService userService;
    private final UserTokenProvider userTokenProvider;
    private final DemoLimiter demoLimiter;
    private final TokenDenyList tokenDenyList;
    private final Logger logger = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

    public JwtAuthenticationFilter(UserService userService, UserTokenProvider userTokenProvider,
                                   DemoLimiter demoLimiter,
                                   TokenDenyList tokenDenyList) {
        this.userService = userService;
        this.userTokenProvider = userTokenProvider;
        this.demoLimiter = demoLimiter;
        this.tokenDenyList = tokenDenyList;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response, @NonNull FilterChain filterChain) throws ServletException, IOException {
        String path = request.getRequestURI();
        logger.info("Filter processing request to: {}", path);

        if (PublicPaths.isPublicPath(path)) {
            filterChain.doFilter(request, response);
            return;
        }

        String authHeader = request.getHeader("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String jwt = authHeader.substring(7);

            if (tokenDenyList.isRevoked(jwt)) {
                logger.warn("Revoked token used on: {}", path);
                filterChain.doFilter(request, response);
                return;
            }

            Optional<UUID> userId = userTokenProvider.validateAndGetUserId(jwt);

            if (userId.isPresent()) {
                if (SecurityContextHolder.getContext().getAuthentication() == null) {
                    userService.getUserFromToken(jwt).ifPresent(userDAO -> {
                        UsernamePasswordAuthenticationToken auth =
                                new UsernamePasswordAuthenticationToken(userDAO, null, null);
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    });
                }
            } else if (demoLimiter.isDemoMode()) {
                userService.getUserFromDemoToken(jwt).ifPresentOrElse(
                        userDAO -> {
                            UsernamePasswordAuthenticationToken auth =
                                    new UsernamePasswordAuthenticationToken(userDAO, null, null);
                            SecurityContextHolder.getContext().setAuthentication(auth);
                        },
                        () -> logger.warn("Invalid or expired token")
                );
            } else {
                logger.warn("Invalid or expired token");
            }
        }

        filterChain.doFilter(request, response);
    }
}