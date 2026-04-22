package config

import (
	"os"
	"strconv"
)

type Limits struct {
	MaxRequestBodyBytes  int64
	MaxHubNameLen        int
	MaxChannelNameLen    int
	MaxCiphertextLen     int
	MaxIVLen             int
	MaxKeyVersionLen     int
	MaxPublicKeyLen      int
	MaxDeviceIDLen       int
	MaxBundlesPerRequest int
}

var C Limits

func InitLimits() {
	C = Limits{
		MaxRequestBodyBytes:  getInt64("MAX_REQUEST_BODY_BYTES", 1<<20), // 1MB
		MaxHubNameLen:        getInt("MAX_HUB_NAME_LEN", 25),
		MaxChannelNameLen:    getInt("MAX_CHANNEL_NAME_LEN", 30),
		MaxCiphertextLen:     getInt("MAX_CIPHERTEXT_LEN", 65536),
		MaxIVLen:             getInt("MAX_IV_LEN", 256),
		MaxKeyVersionLen:     getInt("MAX_KEY_VERSION_LEN", 64),
		MaxPublicKeyLen:      getInt("MAX_PUBLIC_KEY_LEN", 512),
		MaxDeviceIDLen:       getInt("MAX_DEVICE_ID_LEN", 128),
		MaxBundlesPerRequest: getInt("MAX_BUNDLES_PER_REQUEST", 500),
	}
}

func getInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func getInt64(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return def
}
