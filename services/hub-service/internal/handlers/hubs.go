package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

func CreateHub(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req structs.CreateHubRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "Hub name is required")
		return
	}

	hub := structs.Hub{
		ID:        uuid.New().String(),
		Name:      req.Name,
		OwnerID:   userID,
		CreatedAt: time.Now(),
	}

	if err := db.DB.Create(&hub).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create hub")
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   userID,
		HubID:    hub.ID,
		Role:     structs.RoleOwner,
		JoinedAt: time.Now(),
	}

	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to add owner membership")
		return
	}

	writeJSON(w, http.StatusCreated, hub)
}

func ListHubs(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var members []structs.Member
	if err := db.DB.Where("user_id = ?", userID).Find(&members).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch memberships")
		return
	}

	hubIDs := make([]string, len(members))
	for i, m := range members {
		hubIDs[i] = m.HubID
	}

	if len(hubIDs) == 0 {
		writeJSON(w, http.StatusOK, []structs.Hub{})
		return
	}

	var hubs []structs.Hub
	if err := db.DB.Where("id IN ?", hubIDs).Find(&hubs).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch hubs")
		return
	}

	writeJSON(w, http.StatusOK, hubs)
}

func GetHub(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var hub structs.Hub
	if err := db.DB.First(&hub, "id = ?", hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Hub not found")
		return
	}

	writeJSON(w, http.StatusOK, hub)
}

func DeleteHub(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var hub structs.Hub
	if err := db.DB.First(&hub, "id = ?", hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Hub not found")
		return
	}

	if hub.OwnerID != userID {
		writeError(w, http.StatusForbidden, "Only the owner can delete a hub")
		return
	}

	if err := db.DB.Delete(&hub).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete hub")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// POST /api/hubs/{hubID}/bot-join
func BotJoinHub(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Bot-Secret") != os.Getenv("BOT_SECRET") {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	userID := middleware.GetUserID(r) // from JWT
	hubID := chi.URLParam(r, "hubID")

	// Already a member
	var existing structs.Member
	if db.DB.First(&existing, "user_id = ? AND hub_id = ?", userID, hubID).Error == nil {
		writeJSON(w, http.StatusOK, existing)
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   userID,
		HubID:    hubID,
		Role:     structs.RoleBot,
		JoinedAt: time.Now(),
	}
	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to add bot")
		return
	}

	writeJSON(w, http.StatusCreated, member)
}

// Helper functions shared across handlers

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(structs.ErrorResponse{Error: message})
}
