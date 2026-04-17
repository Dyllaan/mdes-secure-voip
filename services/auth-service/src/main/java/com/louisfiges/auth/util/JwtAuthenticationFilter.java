package com.louisfiges.auth.util;

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

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final UserService userService;
    private final UserTokenProvider userTokenProvider;
    private final TokenDenyList tokenDenyList;
    private final Logger logger = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

    public JwtAuthenticationFilter(UserService userService, UserTokenProvider userTokenProvider, TokenDenyList tokenDenyList) {
        this.userService = userService;
        this.userTokenProvider = userTokenProvider;
        this.tokenDenyList = tokenDenyList;
    }

    private static final List<String> PUBLIC_PATHS = Arrays.asList(
            "/user/login",
            "/user/register",
            "/user/refresh",
            "/version"
    );

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response, @NonNull FilterChain filterChain) throws ServletException, IOException {
        String path = request.getRequestURI();
        logger.info("Filter processing request to: {}", path);

        if (PUBLIC_PATHS.contains(path)) {
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

            userTokenProvider.validateAndGetUserId(jwt)
                    .ifPresentOrElse(
                            userId -> {
                                if (SecurityContextHolder.getContext().getAuthentication() == null) {
                                    userService.getUserFromToken(jwt).ifPresent(userDAO -> {
                                        UsernamePasswordAuthenticationToken authenticationToken =
                                                new UsernamePasswordAuthenticationToken(userDAO, null, null);
                                        SecurityContextHolder.getContext().setAuthentication(authenticationToken);
                                    });
                                }
                            },
                            () -> logger.warn("Invalid or expired token")
                    );
        }

        filterChain.doFilter(request, response);
    }
}