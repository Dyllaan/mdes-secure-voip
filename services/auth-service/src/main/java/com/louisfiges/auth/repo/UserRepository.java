package com.louisfiges.auth.repo;

import com.louisfiges.auth.dao.UserDAO;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<UserDAO, UUID> {
    Optional<UserDAO> findByUsername(String username);
    long count();
}