package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"maps"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"

	"github.com/go-routeros/routeros/v3"
	"github.com/spf13/viper"
)

type Config struct {
	Server struct {
		Port int    `mapstructure:"port"`
		Host string `mapstructure:"host"`
	} `mapstructure:"server"`
	Router struct {
		Host     string `mapstructure:"host"`
		Port     int    `mapstructure:"port"`
		Username string `mapstructure:"username"`
		Password string `mapstructure:"password"`
		UseTLS   bool   `mapstructure:"useTLS"`
		debug    bool   `mapstructure:"debug"`
	} `mapstructure:"router"`
}

//go:embed frontend/dist
var staticFiles embed.FS

var Version = "dev-build"

func dial(config Config) (*routeros.Client, error) {
	if config.Router.UseTLS {
		return routeros.DialTLS(fmt.Sprintf("%s:%d", config.Router.Host, config.Router.Port), config.Router.Username, config.Router.Password, nil)
	}

	return routeros.Dial(fmt.Sprintf("%s:%d", config.Router.Host, config.Router.Port), config.Router.Username, config.Router.Password)
}

func fatal(log *slog.Logger, message string, err error) {
	log.Error(message, slog.Any("error", err))
	os.Exit(2)
}

func main() {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")

	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("router.host", "192.168.88.1")
	viper.SetDefault("router.port", 8728)
	viper.SetDefault("router.username", "admin")
	viper.SetDefault("router.password", "")
	viper.SetDefault("router.useTLS", false)

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			log.Println("No config file found, using defaults/env only")

		} else {
			log.Fatalf("Error reading config file: %s", err)
			os.Exit(2)
		}
	}

	var config Config
	if err := viper.Unmarshal(&config); err != nil {
		log.Fatalf("Unable to decode into struct: %v", err)
		os.Exit(2)
	}

	var err error
	if err = flag.CommandLine.Parse(os.Args[1:]); err != nil {
		panic(err)
	}

	logLevel := slog.LevelInfo
	if config.Router.debug {
		logLevel = slog.LevelDebug
	}

	handler := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		AddSource: true,
		Level:     logLevel,
	})

	slogger := slog.New(handler)

	rosClient, err := dial(config)
	if err != nil {
		fatal(slogger, "Could not connect to router", err)
		return
	}

	defer rosClient.Close()
	rosClient.SetLogHandler(handler)
	rosClient.Async()

	mux := http.NewServeMux()

	// Serve embedded static files (React build)
	distFS, err := fs.Sub(staticFiles, "frontend/dist")
	if err != nil {
		log.Println("Failed to create sub filesystem:", err)
	}
	fileServer := http.FileServer(http.FS(distFS))

	// SPA fallback: serve index.html for all non-API routes
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the file; if it doesn't exist, serve index.html
		_, err := distFS.Open(r.URL.Path[1:])
		if err != nil {
			// Serve index.html for SPA routing
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})

	mux.HandleFunc("/api/ip-info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		userIP, _, _ := net.SplitHostPort(r.RemoteAddr)

		res, err := rosClient.RunArgs(strings.Split("/ip/dhcp-server/lease/print detail where ?address="+userIP, " "))
		if err != nil {
			log.Println("Operation failed", err)

			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "erorr running command",
			})

			return
		}

		leasweInfo := make(map[string]string)

		if len(res.Re) == 1 {
			maps.Copy(leasweInfo, res.Re[0].Map)
		} else {
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "ip not found",
			})

			return
		}

		resBridgeHost, err := rosClient.RunArgs(strings.Split("/interface/bridge/host/print where ?mac-address="+leasweInfo["active-mac-address"], " "))
		if err != nil {
			log.Println("Operation failed", err)

			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "erorr running command",
			})

			return
		}

		bridgePort := ""

		if len(resBridgeHost.Re) == 1 {
			bridgePort = resBridgeHost.Re[0].Map["on-interface"]
		}

		json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"data": map[string]any{
				"user-ip":     userIP,
				"bridge-port": bridgePort,
				"lease":       leasweInfo,
			},
		})
	})

	mux.HandleFunc("/api/dhcp-make-static", func(w http.ResponseWriter, r *http.Request) {
		userIP, _, _ := net.SplitHostPort(r.RemoteAddr)

		addr, err := netip.ParseAddr(userIP)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Invalid IP address format",
			})
			return
		}

		if !addr.Is4() {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Invalid IP address family",
			})
			return
		}

		res1, err := rosClient.RunArgs(strings.Split("/ip/dhcp-server/lease/print where ?address="+userIP, " "))
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Failed to find lease to make static",
			})
			return
		}

		leaseId := ""
		leaseDynamic := ""

		if len(res1.Re) == 1 {
			leaseId = res1.Re[0].Map[".id"]
			leaseDynamic = res1.Re[0].Map["dynamic"]
		}

		if leaseId == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Lease not found",
			})
			return
		}

		if leaseDynamic == "false" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Lease is not dynamic",
			})
			return
		}

		_, err = rosClient.RunArgs(strings.Split("/ip/dhcp-server/lease/make-static =.id="+leaseId, " "))
		if err != nil {
			log.Println("Operation failed", err)

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Failed to make lease static",
			})
			return
		}

		res, err := rosClient.RunArgs(strings.Split("/ip/dhcp-server/lease/print where ?dynamic=no and ?address="+userIP, " "))
		if err != nil {
			http.Error(w, "Failed to print lease", http.StatusInternalServerError)

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Failed to validate lease static",
			})
			return
		}

		if len(res.Re) == 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":  "error",
				"message": "Failed to validate lease static (not found)",
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":  "ok",
			"message": "Lease made static",
		})

	})

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		userIP, _, _ := net.SplitHostPort(r.RemoteAddr)

		r1, err := rosClient.RunArgs(strings.Split("/system/resource/print", " "))
		if err != nil {
			log.Println("Operation failed", err)

			json.NewEncoder(w).Encode(map[string]any{
				"status":  "ok",
				"message": "erorr running command",
			})

			return
		}

		info := make(map[string]string)

		for _, re := range r1.Re {
			maps.Copy(info, re.Map)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"status": "ok",
			"data": map[string]any{
				"user-ip": userIP,
				"info":    info,
			},
		})
	})

	log.Printf("Router Manager %s", Version)
	log.Printf("Server listening on http://%s:%d", config.Server.Host, config.Server.Port)

	if err := http.ListenAndServe(fmt.Sprintf("%s:%d", config.Server.Host, config.Server.Port), mux); err != nil {
		fatal(slogger, "Could not start server", err)
		os.Exit(2)
	}
}
