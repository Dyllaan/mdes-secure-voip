package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
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

	var invite structs.InviteCode
	if err := db.DB.First(&invite, "code = ?", code).Error; err != nil {
		writeError(w, http.StatusNotFound, "Invalid invite code")
		return
	}

	if time.Now().After(invite.ExpiresAt) {
		writeError(w, http.StatusGone, "Invite code has expired")
		return
	}

	var existing structs.Member
	if db.DB.First(&existing, "user_id = ? AND hub_id = ?", userID, invite.HubID).Error == nil {
		writeError(w, http.StatusConflict, "Already a member of this hub")
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   userID,
		HubID:    invite.HubID,
		Role:     structs.RoleMember,
		JoinedAt: time.Now(),
	}

	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to join hub")
		return
	}

	// Return hub details alongside membership so the client can navigate directly
	var hub structs.Hub
	db.DB.First(&hub, "id = ?", invite.HubID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"hub":    hub,
		"member": member,
	})
}
