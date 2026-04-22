package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"gorm.io/gorm/clause"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

func InviteMember(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var hub structs.Hub
	if err := db.DB.First(&hub, "id = ?", hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Hub not found")
		return
	}

	if hub.OwnerID != userID {
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
	if db.DB.First(&existing, "user_id = ? AND hub_id = ?", req.UserID, hubID).Error == nil {
		writeError(w, http.StatusConflict, "User is already a member")
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   req.UserID,
		HubID:    hubID,
		Role:     structs.RoleMember,
		JoinedAt: time.Now(),
	}

	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to invite member")
		return
	}

	writeJSON(w, http.StatusCreated, member)
}

func KickMember(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	memberID := chi.URLParam(r, "memberID")

	var hub structs.Hub
	if err := db.DB.First(&hub, "id = ?", hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Hub not found")
		return
	}

	if hub.OwnerID != userID {
		writeError(w, http.StatusForbidden, "Only the owner can kick members")
		return
	}

	var member structs.Member
	if err := db.DB.First(&member, "id = ? AND hub_id = ?", memberID, hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Member not found")
		return
	}

	if member.Role == structs.RoleOwner {
		writeError(w, http.StatusForbidden, "Cannot kick the owner")
		return
	}

	if err := db.DB.Delete(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to kick member")
		return
	}

	if err := markHubChannelsForRotation(hubID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to mark channel rotation")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func ListMembers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var requester structs.Member
	if err := db.DB.First(&requester, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var members []structs.Member
	if err := db.DB.Where("hub_id = ?", hubID).Find(&members).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch members")
		return
	}

	writeJSON(w, http.StatusOK, members)
}

func SyncMyUsername(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	username := middleware.GetUsername(r)
	hubID := chi.URLParam(r, "hubID")

	if username == "" {
		writeError(w, http.StatusBadRequest, "No username in token")
		return
	}

	result := db.DB.Model(&structs.Member{}).
		Where("user_id = ? AND hub_id = ?", userID, hubID).
		Update("username", username)

	if result.RowsAffected == 0 {
		writeError(w, http.StatusNotFound, "Membership not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func LeaveHub(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Not a member of this hub")
		return
	}

	// Owner must delete the hub rather than leave it
	if member.Role == structs.RoleOwner {
		writeError(w, http.StatusForbidden, "Owner cannot leave - delete the hub instead")
		return
	}

	if err := db.DB.Delete(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to leave hub")
		return
	}

	if err := markHubChannelsForRotation(hubID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to mark channel rotation")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func markHubChannelsForRotation(hubID string) error {
	var channels []structs.Channel
	if err := db.DB.Where("hub_id = ?", hubID).Find(&channels).Error; err != nil {
		return err
	}

	now := time.Now()
	for _, ch := range channels {
		flag := structs.ChannelKeyRotationFlag{
			ChannelID:           ch.ID,
			RotationNeeded:      true,
			RotationNeededSince: now,
		}
		if err := db.DB.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "channel_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"rotation_needed", "rotation_needed_since"}),
		}).Create(&flag).Error; err != nil {
			return err
		}
	}

	return nil
}
