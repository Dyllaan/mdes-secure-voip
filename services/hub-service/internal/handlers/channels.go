package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"

	"regexp"
	"strings"
)

// ephemeralChannelRE validates the ephemeral-{uuid} format to prevent malformed IDs
// from reaching the database query (e.g. ephemeral-../../etc).
var ephemeralChannelRE = regexp.MustCompile(`^ephemeral-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func CreateChannel(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
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
	if db.DB.First(&existing, "name = ? AND hub_id = ?", req.Name, hubID).Error == nil {
		writeError(w, http.StatusConflict, "A channel with this name already exists")
		return
	}

	channel := structs.Channel{
		ID:        uuid.New().String(),
		Name:      req.Name,
		HubID:     hubID,
		Type:      req.Type,
		CreatedAt: time.Now(),
	}

	if err := db.DB.Create(&channel).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create channel")
		return
	}

	writeJSON(w, http.StatusCreated, channel)
}

func CheckChannelAccess(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	channelID := chi.URLParam(r, "channelID")

	if strings.HasPrefix(channelID, "ephemeral-") {
		// Validate format: ephemeral-{uuid} before using the extracted hubID in a DB query.
		if !ephemeralChannelRE.MatchString(channelID) {
			writeError(w, http.StatusBadRequest, "Invalid ephemeral channel ID format")
			return
		}
		// Format: ephemeral-{hubId}
		// Strip "ephemeral-" prefix
		hubID := strings.TrimPrefix(channelID, "ephemeral-")

		var member structs.Member
		if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
			writeError(w, http.StatusForbidden, "Not a member of this hub")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"userID":    userID,
			"channelID": channelID,
			"hubID":     hubID,
			"role":      string(member.Role),
		})
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ?", channelID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found")
		return
	}

	if channel.Type != structs.ChannelTypeVoice {
		writeError(w, http.StatusForbidden, "Channel is not a voice channel")
		return
	}

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, channel.HubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"userID":    userID,
		"channelID": channelID,
		"hubID":     channel.HubID,
		"role":      string(member.Role),
	})
}

func ListChannels(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var channels []structs.Channel
	if err := db.DB.Where("hub_id = ?", hubID).Order("created_at asc").Find(&channels).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch channels")
		return
	}

	writeJSON(w, http.StatusOK, channels)
}

func DeleteChannel(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	if member.Role != structs.RoleOwner && member.Role != structs.RoleAdmin {
		writeError(w, http.StatusForbidden, "Only owners and admins can delete channels")
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ? AND hub_id = ?", channelID, hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found")
		return
	}

	if err := db.DB.Delete(&channel).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete channel")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
