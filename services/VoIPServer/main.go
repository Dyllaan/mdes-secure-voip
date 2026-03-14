package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"

	"VoIPServer/internal/db"
	"VoIPServer/internal/handlers"
	"VoIPServer/internal/middleware"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	middleware.InitAuth()

	if err := db.Connect(); err != nil {
		log.Fatal("Database connection failed:", err)
	}

	r := chi.NewRouter()

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.Auth)

		r.Post("/servers", handlers.CreateServer)
		r.Get("/servers", handlers.ListServers)
		r.Delete("/servers/{serverID}", handlers.DeleteServer)
		r.Get("/servers/{serverID}", handlers.GetServer)

		r.Post("/servers/{serverID}/channels", handlers.CreateChannel)
		r.Get("/servers/{serverID}/channels", handlers.ListChannels)
		r.Delete("/servers/{serverID}/channels/{channelID}", handlers.DeleteChannel)

		r.Post("/servers/{serverID}/members", handlers.InviteMember)
		r.Get("/servers/{serverID}/members", handlers.ListMembers)
		r.Delete("/servers/{serverID}/leave", handlers.LeaveServer)

		r.Post("/servers/{serverID}/channels/{channelID}/messages", handlers.SendMessage)
		r.Get("/servers/{serverID}/channels/{channelID}/messages", handlers.GetMessages)

		r.Post("/servers/{serverID}/ephemeral", handlers.StartEphemeral)
		r.Get("/servers/{serverID}/ephemeral", handlers.GetEphemeral)
		r.Delete("/servers/{serverID}/ephemeral", handlers.EndEphemeral)

		r.Post("/servers/{serverID}/invites", handlers.CreateInvite)
		r.Post("/invites/{code}/redeem", handlers.RedeemInvite)

		r.Put("/servers/{serverID}/device-key", handlers.RegisterDeviceKey)
		r.Get("/servers/{serverID}/device-keys", handlers.GetDeviceKeys)

		r.Post("/servers/{serverID}/channel-keys/bundles", handlers.PostKeyBundles)
		r.Get("/servers/{serverID}/channel-keys/bundles", handlers.GetKeyBundles)

		r.Post("/servers/{serverID}/channels/{channelID}/rotation-needed", handlers.SetRotationNeeded)
		r.Get("/servers/{serverID}/channels/{channelID}/rotation-needed", handlers.GetRotationNeeded)
		r.Delete("/servers/{serverID}/channels/{channelID}/rotation-needed", handlers.ClearRotationNeeded)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("VoIPServer listening on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
