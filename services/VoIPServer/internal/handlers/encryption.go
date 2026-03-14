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

// RegisterDeviceKey upserts a P-256 ECDH public key for the calling user's device on this server.
// PUT /api/servers/{serverID}/device-key
func RegisterDeviceKey(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var req structs.RegisterDeviceKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.DeviceID == "" {
		writeError(w, http.StatusBadRequest, "deviceId is required")
		return
	}
	if req.PublicKey == "" {
		writeError(w, http.StatusBadRequest, "publicKey is required")
		return
	}

	var existing structs.MemberDeviceKey
	result := db.DB.First(&existing, "user_id = ? AND device_id = ? AND server_id = ?", userID, req.DeviceID, serverID)

	if result.Error == nil {
		existing.PublicKey = req.PublicKey
		existing.UpdatedAt = time.Now()
		if err := db.DB.Save(&existing).Error; err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to update device key")
			return
		}
		writeJSON(w, http.StatusOK, existing)
		return
	}

	deviceKey := structs.MemberDeviceKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		DeviceID:  req.DeviceID,
		ServerID:  serverID,
		PublicKey: req.PublicKey,
		UpdatedAt: time.Now(),
	}

	if err := db.DB.Create(&deviceKey).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to register device key")
		return
	}

	writeJSON(w, http.StatusCreated, deviceKey)
}

// GetDeviceKeys returns all P-256 ECDH public keys for all members of the server.
// GET /api/servers/{serverID}/device-keys
func GetDeviceKeys(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var deviceKeys []structs.MemberDeviceKey
	if err := db.DB.Where("server_id = ?", serverID).Find(&deviceKeys).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch device keys")
		return
	}

	writeJSON(w, http.StatusOK, deviceKeys)
}

// PostKeyBundles stores ECIES-encrypted channel key bundles — one per recipient device.
// POST /api/servers/{serverID}/channel-keys/bundles
func PostKeyBundles(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var req structs.PostKeyBundlesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ChannelID == "" {
		writeError(w, http.StatusBadRequest, "channelId is required")
		return
	}
	if req.KeyVersion < 1 {
		writeError(w, http.StatusBadRequest, "keyVersion must be >= 1")
		return
	}
	if len(req.Bundles) == 0 {
		writeError(w, http.StatusBadRequest, "bundles array is required and must not be empty")
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ? AND server_id = ?", req.ChannelID, serverID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found in this server")
		return
	}

	now := time.Now()
	var created []structs.ChannelKeyBundle

	for _, payload := range req.Bundles {
		if payload.RecipientUserID == "" || payload.RecipientDeviceID == "" ||
			payload.SenderEphemeralPub == "" || payload.Ciphertext == "" || payload.IV == "" {
			writeError(w, http.StatusBadRequest, "Each bundle must have recipientUserId, recipientDeviceId, senderEphemeralPub, ciphertext, and iv")
			return
		}

		var existing structs.ChannelKeyBundle
		result := db.DB.First(&existing,
			"channel_id = ? AND recipient_user_id = ? AND recipient_device_id = ? AND key_version = ?",
			req.ChannelID, payload.RecipientUserID, payload.RecipientDeviceID, req.KeyVersion)

		if result.Error == nil {
			existing.SenderEphemeralPub = payload.SenderEphemeralPub
			existing.Ciphertext = payload.Ciphertext
			existing.IV = payload.IV
			existing.DistributorID = userID
			existing.CreatedAt = now
			if err := db.DB.Save(&existing).Error; err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to update key bundle")
				return
			}
			created = append(created, existing)
		} else {
			bundle := structs.ChannelKeyBundle{
				ID:                 uuid.New().String(),
				ChannelID:          req.ChannelID,
				ServerID:           serverID,
				RecipientUserID:    payload.RecipientUserID,
				RecipientDeviceID:  payload.RecipientDeviceID,
				KeyVersion:         req.KeyVersion,
				SenderEphemeralPub: payload.SenderEphemeralPub,
				Ciphertext:         payload.Ciphertext,
				IV:                 payload.IV,
				DistributorID:      userID,
				CreatedAt:          now,
			}
			if err := db.DB.Create(&bundle).Error; err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to store key bundle")
				return
			}
			created = append(created, bundle)
		}
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"stored": len(created),
	})
}

// GetKeyBundles returns the ECIES-encrypted channel key bundles addressed to the calling user's device(s).
// GET /api/servers/{serverID}/channel-keys/bundles?channelId={channelID}
func GetKeyBundles(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")
	channelID := r.URL.Query().Get("channelId")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	query := db.DB.Where("server_id = ? AND recipient_user_id = ?", serverID, userID)
	if channelID != "" {
		query = query.Where("channel_id = ?", channelID)
	}

	var bundles []structs.ChannelKeyBundle
	if err := query.Find(&bundles).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch key bundles")
		return
	}

	writeJSON(w, http.StatusOK, bundles)
}

// SetRotationNeeded marks a channel as needing a key rotation.
// Called when a member is removed — any remaining member who comes online will pick this up.
// POST /api/servers/{serverID}/channels/{channelID}/rotation-needed
func SetRotationNeeded(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var body struct {
		RemovedUserID string `json:"removedUserId"`
	}
	json.NewDecoder(r.Body).Decode(&body) // body is optional

	now := time.Now()
	flag := structs.ChannelKeyRotationFlag{
		ChannelID:           channelID,
		RotationNeeded:      true,
		RotationNeededSince: now,
		RemovedUserID:       body.RemovedUserID,
	}

	if err := db.DB.Save(&flag).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to set rotation flag")
		return
	}

	writeJSON(w, http.StatusOK, flag)
}

// GetRotationNeeded returns the rotation flag for a channel.
// GET /api/servers/{serverID}/channels/{channelID}/rotation-needed
func GetRotationNeeded(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	var flag structs.ChannelKeyRotationFlag
	if err := db.DB.First(&flag, "channel_id = ?", channelID).Error; err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"rotationNeeded": false,
		})
		return
	}

	writeJSON(w, http.StatusOK, flag)
}

// ClearRotationNeeded clears the rotation flag after a successful key rotation.
// DELETE /api/servers/{serverID}/channels/{channelID}/rotation-needed
func ClearRotationNeeded(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	serverID := chi.URLParam(r, "serverID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND server_id = ?", userID, serverID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this server")
		return
	}

	db.DB.Delete(&structs.ChannelKeyRotationFlag{}, "channel_id = ?", channelID)

	w.WriteHeader(http.StatusNoContent)
}
