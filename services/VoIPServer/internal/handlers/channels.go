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

func CreateChannel(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	if member.Role != structs.RoleOwner && member.Role != structs.RoleAdmin {
		writeError(w, http.StatusForbidden, "Only owners and admins can create channels")
		return
	}

	var req structs.CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "Channel name is required")
		return
	}

	if req.Type == "" {
		req.Type = structs.ChannelTypeText
	}
	if req.Type != structs.ChannelTypeText && req.Type != structs.ChannelTypeVoice {
		writeError(w, http.StatusBadRequest, "Channel type must be \"text\" or \"voice\"")
		return
	}

	var existing structs.Channel
	if db.DB.First(&existing, "name = ? AND server_id = ?", req.Name, serverID).Error == nil {
		writeError(w, http.StatusConflict, "A channel with this name already exists")
		return
	}

	channel := structs.Channel{
		ID:        uuid.New().String(),
		Name:      req.Name,
		ServerID:  serverID,
		Type:      req.Type,
		CreatedAt: time.Now(),
	}

	if err := db.DB.Create(&channel).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create channel")
		return
	}

	writeJSON(w, http.StatusCreated, channel)
}

func ListChannels(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var channels []structs.Channel
	if err := db.DB.Where("server_id = ?", serverID).Order("created_at asc").Find(&channels).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch channels")
		return
	}

	writeJSON(w, http.StatusOK, channels)
}

func DeleteChannel(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	if member.Role != structs.RoleOwner && member.Role != structs.RoleAdmin {
		writeError(w, http.StatusForbidden, "Only owners and admins can delete channels")
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ? AND server_id = ?", channelID, serverID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found")
		return
	}

	if err := db.DB.Delete(&channel).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete channel")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
