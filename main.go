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
		Debug    bool   `mapstructure:"debug"`
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

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"status":  "error",
		"message": message,
	})
}

func requestUserIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		return strings.TrimSpace(ips[0])
	}
	userIP, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return userIP
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
	if config.Router.Debug {
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

	mux.HandleFunc("/api/ip-rule-tables", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		res, err := rosClient.RunArgs([]string{"/routing/table/print"})

		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "error running command")
			return
		}

		ipRuleTables := []map[string]string{}

		for _, v := range res.Re {
			ipRuleTables = append(ipRuleTables, v.Map)
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"data":   ipRuleTables,
		})
	})

	mux.HandleFunc("/api/ip-rule", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		userIP := requestUserIP(r)

		if r.Method == http.MethodPost {
			var data map[string]string
			err := json.NewDecoder(r.Body).Decode(&data)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, err.Error())
				return
			}
			defer r.Body.Close()

			if data["table"] == "" || data[".id"] == "" {
				writeJSONError(w, http.StatusBadRequest, "table and .id are required")
				return
			}

			_, err = rosClient.RunArgs([]string{"/routing/rule/set", "=.id=" + data[".id"], "=table=" + data["table"]})
			if err != nil {
				log.Println("Operation failed", err)
				writeJSONError(w, http.StatusBadGateway, "failed to update rule")
				return
			}
		}

		res, err := rosClient.RunArgs([]string{"/routing/rule/print"})
		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "error running command")
			return
		}

		var ipRule map[string]any

		for _, v := range res.Re {
			if v.Map["src-address"] == userIP+"/32" &&
				v.Map["action"] == "lookup" &&
				v.Map["dst-address"] == "" &&
				v.Map["interface"] == "" &&
				v.Map["routing-mark"] == "" &&
				v.Map["chain"] == "" {

				ipRule = map[string]any{
					".id":         v.Map[".id"],
					"src-address": v.Map["src-address"],
					"disabled":    v.Map["disabled"],
					"table":       v.Map["table"],
				}

				break
			}
		}

		if ipRule != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"status": "ok",
				"data":   ipRule,
			})

			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"data":   nil,
		})
	})

	mux.HandleFunc("/api/ip-info", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		userIP := requestUserIP(r)

		res, err := rosClient.RunArgs([]string{"/ip/dhcp-server/lease/print", "?address=" + userIP})
		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "error running command")
			return
		}

		leaseInfo := make(map[string]string)

		if len(res.Re) >= 1 {
			maps.Copy(leaseInfo, res.Re[0].Map)
		} else {
			log.Printf("No lease found for IP: %s", userIP)
			writeJSON(w, http.StatusNotFound, map[string]any{
				"status":  "error",
				"message": "ip not found",
				"data": map[string]any{
					"user-ip": userIP,
				},
			})
			return
		}

		bridgePort := ""
		macAddr := leaseInfo["active-mac-address"]
		if macAddr == "" {
			macAddr = leaseInfo["mac-address"]
		}

		if macAddr != "" {
			resBridgeHost, err := rosClient.RunArgs([]string{"/interface/bridge/host/print", "?mac-address=" + macAddr})
			if err == nil && len(resBridgeHost.Re) >= 1 {
				bridgePort = resBridgeHost.Re[0].Map["on-interface"]
			} else if err != nil {
				log.Println("Bridge host lookup failed", err)
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"data": map[string]any{
				"user-ip":     userIP,
				"bridge-port": bridgePort,
				"lease":       leaseInfo,
			},
		})
	})

	mux.HandleFunc("/api/dhcp-make-static", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		userIP := requestUserIP(r)

		addr, err := netip.ParseAddr(userIP)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid IP address format")
			return
		}

		if !addr.Is4() {
			writeJSONError(w, http.StatusBadRequest, "invalid IP address family")
			return
		}

		res1, err := rosClient.RunArgs([]string{"/ip/dhcp-server/lease/print", "?address=" + userIP})
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, "failed to find lease to make static")
			return
		}

		leaseId := ""
		leaseDynamic := ""

		if len(res1.Re) >= 1 {
			leaseId = res1.Re[0].Map[".id"]
			leaseDynamic = res1.Re[0].Map["dynamic"]
		}

		if leaseId == "" {
			writeJSONError(w, http.StatusNotFound, "lease not found")
			return
		}

		if leaseDynamic == "false" {
			writeJSONError(w, http.StatusConflict, "lease is not dynamic")
			return
		}

		_, err = rosClient.RunArgs([]string{"/ip/dhcp-server/lease/make-static", "=.id=" + leaseId})
		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "failed to make lease static")
			return
		}

		res, err := rosClient.RunArgs([]string{"/ip/dhcp-server/lease/print", "?address=" + userIP})
		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "failed to validate lease static")
			return
		}

		if len(res.Re) == 0 || res.Re[0].Map["dynamic"] == "true" {
			writeJSONError(w, http.StatusInternalServerError, "failed to validate lease static")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"message": "Lease made static",
		})
	})

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		userIP := requestUserIP(r)

		r1, err := rosClient.RunArgs([]string{"/system/resource/print"})
		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "error running command")
			return
		}

		info := make(map[string]string)

		for _, re := range r1.Re {
			maps.Copy(info, re.Map)
		}

		writeJSON(w, http.StatusOK, map[string]any{
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
