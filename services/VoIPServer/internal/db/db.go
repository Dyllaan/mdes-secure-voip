package db

import (
	"fmt"
	"log"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"VoIPServer/internal/structs"
)

var DB *gorm.DB

func Connect() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL not set")
	}

	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	err = database.AutoMigrate(
		&structs.Server{},
		&structs.Channel{},
		&structs.Member{},
		&structs.Message{},
		&structs.InviteCode{},
		&structs.MemberDeviceKey{},
		&structs.ChannelKeyBundle{},
		&structs.ChannelKeyRotationFlag{},
	)
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}

	DB = database
	log.Println("Database connected and migrations applied")
	return nil
}
