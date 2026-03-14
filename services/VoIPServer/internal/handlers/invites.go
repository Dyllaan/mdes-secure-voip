package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"VoIPServer/internal/db"
	"VoIPServer/internal/middleware"
	"VoIPServer/internal/structs"
)

func CreateInvite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	bytes := make([]byte, 4)
	rand.Read(bytes)
	code := hex.EncodeToString(bytes)

	invite := structs.InviteCode{
		ID:        uuid.New().String(),
		ServerID:  serverID,
		Code:      code,
		CreatedAt: time.Now(),
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

	var existing structs.Member
	if db.DB.First(&existing, "user_id = ? AND server_id = ?", userID, invite.ServerID).Error == nil {
		writeError(w, http.StatusConflict, "Already a member of this server")
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   userID,
		ServerID: invite.ServerID,
		Role:     structs.RoleMember,
		JoinedAt: time.Now(),
	}

	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to join server")
		return
	}

	// Return server details alongside membership so the client can navigate directly
	var server structs.Server
	db.DB.First(&server, "id = ?", invite.ServerID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"server": server,
		"member": member,
	})
}
