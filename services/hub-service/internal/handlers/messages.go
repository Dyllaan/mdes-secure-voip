package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

func SendMessage(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ? AND hub_id = ?", channelID, hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found")
		return
	}

	var req structs.SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Ciphertext == "" || req.IV == "" || req.KeyVersion == "" {
		writeError(w, http.StatusBadRequest, "Ciphertext, IV, and key version are required")
		return
	}

	message := structs.Message{
		ID:         uuid.New().String(),
		ChannelID:  channelID,
		SenderID:   userID,
		Ciphertext: req.Ciphertext,
		IV:         req.IV,
		KeyVersion: req.KeyVersion,
		Timestamp:  time.Now(),
	}

	if err := db.DB.Create(&message).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to store message")
		return
	}

	writeJSON(w, http.StatusCreated, message)
}

func GetMessages(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ? AND hub_id = ?", channelID, hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found")
		return
	}

	// Default 50 messages per page, max 100
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	// Cursor-based: fetch messages before a given RFC3339 timestamp
	query := db.DB.Where("channel_id = ?", channelID)
	if before := r.URL.Query().Get("before"); before != "" {
		if t, err := time.Parse(time.RFC3339, before); err == nil {
			query = query.Where("timestamp < ?", t)
		}
	}

	var messages []structs.Message
	// Fetch one extra to determine if there are more pages
	if err := query.Order("timestamp desc").Limit(limit + 1).Find(&messages).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch messages")
		return
	}

	hasMore := len(messages) > limit
	if hasMore {
		messages = messages[:limit]
	}

	// Reverse to chronological order for the response
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	writeJSON(w, http.StatusOK, structs.MessageHistoryResponse{
		Messages: messages,
		HasMore:  hasMore,
	})
}
