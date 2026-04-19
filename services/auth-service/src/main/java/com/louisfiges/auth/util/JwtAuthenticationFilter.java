package com.louisfiges.auth.util;

import com.louisfiges.auth.config.DemoLimiter;
import com.louisfiges.auth.constants.PublicPaths;
import com.louisfiges.auth.service.DemoSessionService;
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

import com.louisfiges.auth.dao.UserDAO;
import com.louisfiges.auth.service.UserService;

import java.io.IOException;
import java.util.Optional;
import java.util.UUID;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final UserService userService;
    private final UserTokenProvider userTokenProvider;
    private final DemoLimiter demoLimiter;
    private final TokenDenyList tokenDenyList;
    private final DemoSessionService demoSessionService;
    private final DemoTokenProvider demoTokenProvider;
    private final Logger logger = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

    public JwtAuthenticationFilter(UserService userService, UserTokenProvider userTokenProvider,
                                   DemoLimiter demoLimiter, TokenDenyList tokenDenyList,
                                   DemoSessionService demoSessionService, DemoTokenProvider demoTokenProvider) {
        this.userService = userService;
        this.userTokenProvider = userTokenProvider;
        this.demoLimiter = demoLimiter;
        this.tokenDenyList = tokenDenyList;
        this.demoSessionService = demoSessionService;
        this.demoTokenProvider = demoTokenProvider;
    }

    // Logout must always succeed even for expired demo users — the frontend clears state and revokes tokens.
    private static final String LOGOUT_PATH = "/user/logout";

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
                Optional<UserDAO> userOpt = userService.getUserById(userId.get());
                if (userOpt.isPresent()) {
                    UserDAO userDAO = userOpt.get();

                    if (!LOGOUT_PATH.equals(path) && isDemoExpiredForUser(userDAO)) {
                        logger.warn("Demo session expired for user {} on path: {}", userDAO.getUsername(), path);
                        writeDemoExpiredResponse(response, demoTokenProvider.generateToken(userDAO.getId()));
                        return;
                    }

                    if (SecurityContextHolder.getContext().getAuthentication() == null) {
                        UsernamePasswordAuthenticationToken auth =
                                new UsernamePasswordAuthenticationToken(userDAO, null, null);
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }
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

    private boolean isDemoExpiredForUser(UserDAO userDAO) {
        if (!demoLimiter.isDemoMode() || demoLimiter.isAllowedUser(userDAO.getUsername())) {
            return false;
        }
        try {
            return demoSessionService.isDemoExpired(userDAO.getId());
        } catch (Exception e) {
            logger.error("Demo expiry check failed for user {} — failing open: {}", userDAO.getUsername(), e.getMessage());
            return false;
        }
    }

    private void writeDemoExpiredResponse(HttpServletResponse response, String demoToken) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.getWriter().write(
            "{\"demoToken\":\"" + demoToken + "\",\"message\":\"Your demo session has expired. Use the demo token to delete your account.\"}"
        );
    }
}