package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"

	"hub-service/internal/db"
	"hub-service/internal/handlers"
	"hub-service/internal/middleware"
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

		r.Get("/channels/{channelID}/access", handlers.CheckChannelAccess)

		r.Post("/hubs", handlers.CreateHub)
		r.Get("/hubs", handlers.ListHubs)
		r.Delete("/hubs/{hubID}", handlers.DeleteHub)
		r.Get("/hubs/{hubID}", handlers.GetHub)

		r.Post("/hubs/{hubID}/bot-join", handlers.BotJoinHub)

		r.Post("/hubs/{hubID}/channels", handlers.CreateChannel)
		r.Get("/hubs/{hubID}/channels", handlers.ListChannels)
		r.Delete("/hubs/{hubID}/channels/{channelID}", handlers.DeleteChannel)

		r.Post("/hubs/{hubID}/members", handlers.InviteMember)
		r.Get("/hubs/{hubID}/members", handlers.ListMembers)
		r.Delete("/hubs/{hubID}/leave", handlers.LeaveHub)
		r.Delete("/hubs/{hubID}/members/{memberID}", handlers.KickMember)

		r.Post("/hubs/{hubID}/channels/{channelID}/messages", handlers.SendMessage)
		r.Get("/hubs/{hubID}/channels/{channelID}/messages", handlers.GetMessages)

		r.Post("/hubs/{hubID}/ephemeral", handlers.StartEphemeral)
		r.Get("/hubs/{hubID}/ephemeral", handlers.GetEphemeral)
		r.Delete("/hubs/{hubID}/ephemeral", handlers.EndEphemeral)

		r.Post("/hubs/{hubID}/invites", handlers.CreateInvite)
		r.Post("/invites/{code}/redeem", handlers.RedeemInvite)

		r.Put("/hubs/{hubID}/device-key", handlers.RegisterDeviceKey)
		r.Get("/hubs/{hubID}/device-keys", handlers.GetDeviceKeys)

		r.Post("/hubs/{hubID}/channel-keys/bundles", handlers.PostKeyBundles)
		r.Get("/hubs/{hubID}/channel-keys/bundles", handlers.GetKeyBundles)

		r.Post("/hubs/{hubID}/channels/{channelID}/rotation-needed", handlers.SetRotationNeeded)
		r.Get("/hubs/{hubID}/channels/{channelID}/rotation-needed", handlers.GetRotationNeeded)
		r.Delete("/hubs/{hubID}/channels/{channelID}/rotation-needed", handlers.ClearRotationNeeded)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Hub Service listening on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
