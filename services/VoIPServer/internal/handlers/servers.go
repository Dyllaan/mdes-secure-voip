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

func CreateServer(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req structs.CreateServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "Server name is required")
		return
	}

	server := structs.Server{
		ID:        uuid.New().String(),
		Name:      req.Name,
		OwnerID:   userID,
		CreatedAt: time.Now(),
	}

	if err := db.DB.Create(&server).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create server")
		return
	}

	member := structs.Member{
		ID:       uuid.New().String(),
		UserID:   userID,
		ServerID: server.ID,
		Role:     structs.RoleOwner,
		JoinedAt: time.Now(),
	}

	if err := db.DB.Create(&member).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to add owner membership")
		return
	}

	writeJSON(w, http.StatusCreated, server)
}

func ListServers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var members []structs.Member
	if err := db.DB.Where("user_id = ?", userID).Find(&members).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch memberships")
		return
	}

	serverIDs := make([]string, len(members))
	for i, m := range members {
		serverIDs[i] = m.ServerID
	}

	if len(serverIDs) == 0 {
		writeJSON(w, http.StatusOK, []structs.Server{})
		return
	}

	var servers []structs.Server
	if err := db.DB.Where("id IN ?", serverIDs).Find(&servers).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch servers")
		return
	}

	writeJSON(w, http.StatusOK, servers)
}

func GetServer(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var server structs.Server
	if err := db.DB.First(&server, "id = ?", serverID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	writeJSON(w, http.StatusOK, server)
}

func DeleteServer(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var server structs.Server
	if err := db.DB.First(&server, "id = ?", serverID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	if server.OwnerID != userID {
		writeError(w, http.StatusForbidden, "Only the owner can delete a server")
		return
	}

	if err := db.DB.Delete(&server).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete server")
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
