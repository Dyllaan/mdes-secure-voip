package handlers

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"hub-service/internal/config"
	"hub-service/internal/db"
	"hub-service/internal/middleware"
	"hub-service/internal/structs"
)

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return ip
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

// RegisterDeviceKey upserts a P-256 ECDH public key for the calling user's device on this hub.
// PUT /api/hubs/{hubID}/device-key
func RegisterDeviceKey(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
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
	if len(req.DeviceID) > config.C.MaxDeviceIDLen {
		log.Printf("validation: deviceId too long (%d bytes) from %s user=%s", len(req.DeviceID), clientIP(r), userID)
		writeError(w, http.StatusBadRequest, "deviceId too long")
		return
	}
	if req.PublicKey == "" {
		writeError(w, http.StatusBadRequest, "publicKey is required")
		return
	}
	if len(req.PublicKey) > config.C.MaxPublicKeyLen {
		log.Printf("validation: publicKey too long (%d bytes) from %s user=%s", len(req.PublicKey), clientIP(r), userID)
		writeError(w, http.StatusBadRequest, "publicKey too long")
		return
	}
	if _, err := base64.StdEncoding.DecodeString(req.PublicKey); err != nil {
		log.Printf("validation: publicKey invalid base64 from %s user=%s", clientIP(r), userID)
		writeError(w, http.StatusBadRequest, "publicKey must be valid base64")
		return
	}

	var existing structs.MemberDeviceKey
	result := db.DB.First(&existing, "user_id = ? AND device_id = ? AND hub_id = ?", userID, req.DeviceID, hubID)

	if result.Error == nil {
		if err := db.DB.Model(&existing).Updates(map[string]interface{}{
			"public_key": req.PublicKey,
			"updated_at": time.Now(),
		}).Error; err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to update device key")
			return
		}
		existing.PublicKey = req.PublicKey
		writeJSON(w, http.StatusOK, existing)
		return
	}

	deviceKey := structs.MemberDeviceKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		DeviceID:  req.DeviceID,
		HubID:     hubID,
		PublicKey: req.PublicKey,
		UpdatedAt: time.Now(),
	}

	if err := db.DB.Create(&deviceKey).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to register device key")
		return
	}

	writeJSON(w, http.StatusCreated, deviceKey)
}

// GetDeviceKeys returns all P-256 ECDH public keys for all members of the hub.
// GET /api/hubs/{hubID}/device-keys
func GetDeviceKeys(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	var deviceKeys []structs.MemberDeviceKey
	if err := db.DB.Where("hub_id = ?", hubID).Find(&deviceKeys).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to fetch device keys")
		return
	}

	writeJSON(w, http.StatusOK, deviceKeys)
}

// PostKeyBundles stores ECIES-encrypted channel key bundles - one per recipient device.
// POST /api/hubs/{hubID}/channel-keys/bundles
func PostKeyBundles(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
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
	if len(req.Bundles) > config.C.MaxBundlesPerRequest {
		log.Printf("validation: bundle count too high (%d) from %s user=%s", len(req.Bundles), clientIP(r), userID)
		writeError(w, http.StatusBadRequest, "Too many bundles in a single request")
		return
	}

	var channel structs.Channel
	if err := db.DB.First(&channel, "id = ? AND hub_id = ?", req.ChannelID, hubID).Error; err != nil {
		writeError(w, http.StatusNotFound, "Channel not found in this hub")
		return
	}

	// Build a set of valid member user IDs for this hub so we can validate
	// each bundle's recipient without a per-bundle DB round-trip.
	var hubMembers []structs.Member
	if err := db.DB.Where("hub_id = ?", hubID).Find(&hubMembers).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to verify hub membership")
		return
	}
	memberSet := make(map[string]struct{}, len(hubMembers))
	for _, m := range hubMembers {
		memberSet[m.UserID] = struct{}{}
	}

	now := time.Now()
	var created []structs.ChannelKeyBundle

	for _, payload := range req.Bundles {
		if payload.RecipientUserID == "" || payload.RecipientDeviceID == "" ||
			payload.SenderEphemeralPub == "" || payload.Ciphertext == "" || payload.IV == "" {
			writeError(w, http.StatusBadRequest, "Each bundle must have recipientUserId, recipientDeviceId, senderEphemeralPub, ciphertext, and iv")
			return
		}
		if len(payload.SenderEphemeralPub) > config.C.MaxPublicKeyLen {
			log.Printf("validation: senderEphemeralPub too long (%d bytes) from %s user=%s", len(payload.SenderEphemeralPub), clientIP(r), userID)
			writeError(w, http.StatusBadRequest, "senderEphemeralPub too long")
			return
		}
		if len(payload.Ciphertext) > config.C.MaxCiphertextLen {
			log.Printf("validation: bundle ciphertext too long (%d bytes) from %s user=%s", len(payload.Ciphertext), clientIP(r), userID)
			writeError(w, http.StatusBadRequest, "Bundle ciphertext too long")
			return
		}
		if len(payload.IV) > config.C.MaxIVLen {
			log.Printf("validation: bundle IV too long (%d bytes) from %s user=%s", len(payload.IV), clientIP(r), userID)
			writeError(w, http.StatusBadRequest, "Bundle IV too long")
			return
		}
		if _, err := base64.StdEncoding.DecodeString(payload.SenderEphemeralPub); err != nil {
			log.Printf("validation: senderEphemeralPub invalid base64 from %s user=%s", clientIP(r), userID)
			writeError(w, http.StatusBadRequest, "senderEphemeralPub must be valid base64")
			return
		}
		if _, err := base64.StdEncoding.DecodeString(payload.Ciphertext); err != nil {
			log.Printf("validation: bundle ciphertext invalid base64 from %s user=%s", clientIP(r), userID)
			writeError(w, http.StatusBadRequest, "Bundle ciphertext must be valid base64")
			return
		}
		if _, err := base64.StdEncoding.DecodeString(payload.IV); err != nil {
			log.Printf("validation: bundle IV invalid base64 from %s user=%s", clientIP(r), userID)
			writeError(w, http.StatusBadRequest, "Bundle IV must be valid base64")
			return
		}
		if _, ok := memberSet[payload.RecipientUserID]; !ok {
			writeError(w, http.StatusBadRequest, "Recipient is not a member of this hub")
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
				HubID:              hubID,
				RecipientUserID:    payload.RecipientUserID,
				RecipientDeviceID:  payload.RecipientDeviceID,
				KeyVersion:         req.KeyVersion,
				SenderEphemeralPub: payload.SenderEphemeralPub,
				Ciphertext:         payload.Ciphertext,
				IV:                 payload.IV,
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
// GET /api/hubs/{hubID}/channel-keys/bundles?channelId={channelID}
func GetKeyBundles(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := r.URL.Query().Get("channelId")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	query := db.DB.Where("hub_id = ? AND recipient_user_id = ?", hubID, userID)
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
// Called when a member is removed - any remaining member who comes online will pick this up.
// POST /api/hubs/{hubID}/channels/{channelID}/rotation-needed
func SetRotationNeeded(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	now := time.Now()
	flag := structs.ChannelKeyRotationFlag{
		ChannelID:           channelID,
		RotationNeeded:      true,
		RotationNeededSince: now,
	}

	if err := db.DB.Save(&flag).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to set rotation flag")
		return
	}

	writeJSON(w, http.StatusOK, flag)
}

// GetRotationNeeded returns the rotation flag for a channel.
// GET /api/hubs/{hubID}/channels/{channelID}/rotation-needed
func GetRotationNeeded(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
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
// DELETE /api/hubs/{hubID}/channels/{channelID}/rotation-needed
func ClearRotationNeeded(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	hubID := chi.URLParam(r, "hubID")
	channelID := chi.URLParam(r, "channelID")

	var member structs.Member
	if err := db.DB.First(&member, "user_id = ? AND hub_id = ?", userID, hubID).Error; err != nil {
		writeError(w, http.StatusForbidden, "Not a member of this hub")
		return
	}

	db.DB.Delete(&structs.ChannelKeyRotationFlag{}, "channel_id = ?", channelID)

	w.WriteHeader(http.StatusNoContent)
}
