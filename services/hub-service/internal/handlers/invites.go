package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

var (
	errInviteNotFound = errors.New("invite not found")
	errInviteExpired  = errors.New("invite expired")
	errAlreadyMember  = errors.New("already a member")
)

func inviteTTL() time.Duration {
	hours := 24
	if v := os.Getenv("INVITE_TTL_HOURS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			hours = n
		}
	}
	return time.Duration(hours) * time.Hour
}

func CreateInvite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	bytes := make([]byte, 16)
	rand.Read(bytes)
	code := hex.EncodeToString(bytes)

	now := time.Now()
	invite := structs.InviteCode{
		ID:        uuid.New().String(),
		HubID:     hubID,
		Code:      code,
		CreatedAt: now,
		ExpiresAt: now.Add(inviteTTL()),
	}

	if err := db.DB.Create(&invite).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create invite")
		return
	}

	writeJSON(w, http.StatusCreated, invite)
}

func RedeemInvite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	code := chi.URLParam(r, "code")

	var member structs.Member
	var hub structs.Hub

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var invite structs.InviteCode
		// Lock the invite row for the duration of this transaction to prevent
		// concurrent redemptions of the same code (TOCTOU race condition).
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&invite, "code = ?", code).Error; err != nil {
			return errInviteNotFound
		}

		if time.Now().After(invite.ExpiresAt) {
			return errInviteExpired
		}

		var existing structs.Member
		if tx.First(&existing, "user_id = ? AND hub_id = ?", userID, invite.HubID).Error == nil {
			return errAlreadyMember
		}

		member = structs.Member{
			ID:       uuid.New().String(),
			UserID:   userID,
			Username: middleware.GetUsername(r),
			HubID:    invite.HubID,
			Role:     structs.RoleMember,
			JoinedAt: time.Now(),
		}
		if err := tx.Create(&member).Error; err != nil {
			return err
		}

		// Return hub details alongside membership so the client can navigate directly
		return tx.First(&hub, "id = ?", invite.HubID).Error
	})

	if err == errInviteNotFound {
		writeError(w, http.StatusNotFound, "Invalid invite code")
		return
	}
	if err == errInviteExpired {
		writeError(w, http.StatusGone, "Invite code has expired")
		return
	}
	if err == errAlreadyMember {
		writeError(w, http.StatusConflict, "Already a member of this hub")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to join hub")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"hub":    hub,
		"member": member,
	})
}
