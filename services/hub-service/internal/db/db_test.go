package db_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"hub-service/internal/db"
)

func TestConnect_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	err := db.Connect()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DATABASE_URL not set")
}

func TestConnect_InvalidDSN(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://invalid-host-that-does-not-exist:5432/testdb?connect_timeout=1")
	err := db.Connect()
	// Should return an error (either connection failure or migration failure)
	// The exact error depends on whether GORM connects lazily or eagerly.
	// If GORM connects lazily, the error comes from AutoMigrate.
	// Either way, we expect an error.
	require.Error(t, err)
}
