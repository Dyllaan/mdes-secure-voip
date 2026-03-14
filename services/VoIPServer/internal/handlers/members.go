package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"VoIPServer/internal/db"
	"VoIPServer/internal/middleware"
	"VoIPServer/internal/structs"
)

func InviteMember(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var server structs.Server
	if err := db.DB.First(&server, "id = ?", serverID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	if server.OwnerID != userID {
		writeError(w, http.StatusForbidden, "Only the owner can invite members")
		return
	}

	var req structs.InviteMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.UserID == "" {
		writeError(w, http.StatusBadRequest, "User ID is required")
		return
	}

	var existing structs.Member
	if db.DB.First(&existing, "user_id = ? AND server_id = ?", req.UserID, serverID).Error == nil {
		writeError(w, http.StatusConflict, "User is already a member")
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   req.UserID,
		ServerID: serverID,
		Role:     structs.RoleMember,
		JoinedAt: time.Now(),
	}

	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to invite member")
		return
	}

	writeJSON(w, http.StatusCreated, member)
}

func ListMembers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var requester structs.Member
	if err := db.DB.First(&requester, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var members []structs.Member
	if err := db.DB.Where("server_id = ?", serverID).Find(&members).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch members")
		return
	}

	writeJSON(w, http.StatusOK, members)
}

func LeaveServer(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Not a member of this server")
		return
	}

	// Owner must delete the server rather than leave it
	if member.Role == structs.RoleOwner {
		writeError(w, http.StatusForbidden, "Owner cannot leave — delete the server instead")
		return
	}

	if err := db.DB.Delete(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to leave server")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
