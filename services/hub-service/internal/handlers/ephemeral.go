package handlers

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

const defaultMaxAge = 1800 // 30 minutes

var (
	ephemeralRooms = make(map[string]ephemeralRoom)
	ephemeralMu    sync.RWMutex
)

type ephemeralRoom struct {
	RoomID    string `json:"roomId"`
	CreatedAt int64  `json:"createdAt"`
	MaxAge    int64  `json:"maxAge"`
}

func StartEphemeral(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var req struct {
		RoomID string `json:"roomId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RoomID == "" {
		writeError(w, http.StatusBadRequest, "Room ID is required")
		return
	}

	ephemeralMu.Lock()
	defer ephemeralMu.Unlock()

	if existing, ok := ephemeralRooms[hubID]; ok {
		if time.Now().Unix()-existing.CreatedAt < existing.MaxAge {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"roomId":    existing.RoomID,
				"status":    "already_active",
				"expiresAt": existing.CreatedAt + existing.MaxAge,
			})
			return
		}
		delete(ephemeralRooms, hubID)
	}

	room := ephemeralRoom{
		RoomID:    req.RoomID,
		CreatedAt: time.Now().Unix(),
		MaxAge:    defaultMaxAge,
	}
	ephemeralRooms[hubID] = room

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"roomId":    room.RoomID,
		"status":    "created",
		"expiresAt": room.CreatedAt + room.MaxAge,
	})
}

func GetEphemeral(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	ephemeralMu.Lock()
	defer ephemeralMu.Unlock()

	room, ok := ephemeralRooms[hubID]
	if !ok {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"active": false,
		})
		return
	}

	if time.Now().Unix()-room.CreatedAt >= room.MaxAge {
		delete(ephemeralRooms, hubID)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"active": false,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"active":    true,
		"roomId":    room.RoomID,
		"expiresAt": room.CreatedAt + room.MaxAge,
	})
}

func EndEphemeral(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	ephemeralMu.Lock()
	defer ephemeralMu.Unlock()

	delete(ephemeralRooms, hubID)

	w.WriteHeader(http.StatusNoContent)
}
