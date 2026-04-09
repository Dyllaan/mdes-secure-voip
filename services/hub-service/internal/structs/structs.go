package structs

import "time"

type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
	RoleBot    Role = "bot"
)

type ChannelType string

const (
	ChannelTypeText  ChannelType = "text"
	ChannelTypeVoice ChannelType = "voice"
)

type Hub struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"not null"`
	OwnerID   string    `json:"ownerId" gorm:"not null"`
	CreatedAt time.Time `json:"createdAt"`
}

type InviteCode struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	HubID     string    `json:"hubId" gorm:"not null;index;constraint:OnDelete:CASCADE"`
	Code      string    `json:"code" gorm:"not null;uniqueIndex"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt" gorm:"not null;index"`
}

type Channel struct {
	ID        string      `json:"id" gorm:"primaryKey"`
	Name      string      `json:"name" gorm:"not null;uniqueIndex:idx_channel_hub"`
	HubID     string      `json:"hubId" gorm:"not null;uniqueIndex:idx_channel_hub;constraint:OnDelete:CASCADE"`
	Type      ChannelType `json:"type" gorm:"not null;default:text"`
	CreatedAt time.Time   `json:"createdAt"`
}

type Member struct {
	ID       string    `json:"id" gorm:"primaryKey"`
	UserID   string    `json:"userId" gorm:"not null;uniqueIndex:idx_user_hub"`
	HubID    string    `json:"hubId" gorm:"not null;uniqueIndex:idx_user_hub;constraint:OnDelete:CASCADE"`
	Role     Role      `json:"role" gorm:"not null;default:member"`
	JoinedAt time.Time `json:"joinedAt"`
}

type Message struct {
	ID         string    `json:"id" gorm:"primaryKey"`
	ChannelID  string    `json:"channelId" gorm:"not null;index:idx_channel_time;constraint:OnDelete:CASCADE"`
	SenderID   string    `json:"senderId" gorm:"not null"`
	Ciphertext string    `json:"ciphertext" gorm:"not null"`
	IV         string    `json:"iv" gorm:"not null"`
	KeyVersion string    `json:"keyVersion" gorm:"not null"`
	Timestamp  time.Time `json:"timestamp" gorm:"not null;index:idx_channel_time"`
}

// MemberDeviceKey stores a user's P-256 ECDH public key, scoped per hub.
type MemberDeviceKey struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	UserID    string    `json:"userId" gorm:"not null;index:idx_device_user_hub"`
	DeviceID  string    `json:"deviceId" gorm:"not null;index:idx_device_user_hub"`
	HubID     string    `json:"hubId" gorm:"not null;index:idx_device_user_hub;constraint:OnDelete:CASCADE"`
	PublicKey string    `json:"publicKey" gorm:"not null"` // P-256 SPKI base64
	UpdatedAt time.Time `json:"updatedAt"`
}

// ChannelKeyBundle stores an ECIES-encrypted AES-256-GCM channel key for one recipient device.
type ChannelKeyBundle struct {
	ID                 string    `json:"id" gorm:"primaryKey"`
	ChannelID          string    `json:"channelId" gorm:"not null;index:idx_bundle_channel;constraint:OnDelete:CASCADE"`
	HubID              string    `json:"hubId" gorm:"not null;constraint:OnDelete:CASCADE"`
	RecipientUserID    string    `json:"recipientUserId" gorm:"not null"`
	RecipientDeviceID  string    `json:"recipientDeviceId" gorm:"not null"`
	KeyVersion         int       `json:"keyVersion" gorm:"not null"`
	SenderEphemeralPub string    `json:"senderEphemeralPub" gorm:"not null"` // P-256 SPKI base64
	Ciphertext         string    `json:"ciphertext" gorm:"not null"`         // base64 AES-GCM encrypted raw key bytes
	IV                 string    `json:"iv" gorm:"not null"`                 // base64 12-byte IV
	CreatedAt          time.Time `json:"createdAt"`
}

// ChannelKeyRotationFlag signals that a channel's key needs to be rotated.
type ChannelKeyRotationFlag struct {
	ChannelID           string    `json:"channelId" gorm:"primaryKey;constraint:OnDelete:CASCADE"`
	RotationNeeded      bool      `json:"rotationNeeded" gorm:"not null;default:false"`
	RotationNeededSince time.Time `json:"rotationNeededSince"`
}

type CreateHubRequest struct {
	Name string `json:"name"`
}

type CreateChannelRequest struct {
	Name string      `json:"name"`
	Type ChannelType `json:"type"`
}

type InviteMemberRequest struct {
	UserID string `json:"userId"`
}

type UpdateRoleRequest struct {
	Role Role `json:"role"`
}

type SendMessageRequest struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	KeyVersion string `json:"keyVersion"`
}

type RegisterDeviceKeyRequest struct {
	DeviceID  string `json:"deviceId"`
	PublicKey string `json:"publicKey"`
}

type ChannelKeyBundlePayload struct {
	RecipientUserID    string `json:"recipientUserId"`
	RecipientDeviceID  string `json:"recipientDeviceId"`
	SenderEphemeralPub string `json:"senderEphemeralPub"`
	Ciphertext         string `json:"ciphertext"`
	IV                 string `json:"iv"`
}

type PostKeyBundlesRequest struct {
	ChannelID  string                    `json:"channelId"`
	KeyVersion int                       `json:"keyVersion"`
	Bundles    []ChannelKeyBundlePayload `json:"bundles"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type MessageHistoryResponse struct {
	Messages []Message `json:"messages"`
	HasMore  bool      `json:"hasMore"`
}
