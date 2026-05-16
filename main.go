package main

import (
	"context"
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
	"sync"
	"time"

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

type RouterManager struct {
	config  Config
	client  *routeros.Client
	handler slog.Handler
	mu      sync.Mutex
}

func NewRouterManager(config Config, handler slog.Handler) *RouterManager {
	return &RouterManager{
		config:  config,
		handler: handler,
	}
}

func (m *RouterManager) getClient() (*routeros.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil {
		// Check if connection is still alive by running a no-op command
		// or checking an internal state if available.
		// RunArgs is safer to check actual connectivity.
		_, err := m.client.RunArgs([]string{"/system/identity/print"})
		if err == nil {
			return m.client, nil
		}
		// Connection lost, close and try to reconnect
		m.client.Close()
		m.client = nil
	}

	client, err := dial(m.config)
	if err != nil {
		return nil, err
	}

	client.SetLogHandler(m.handler)
	client.Async()
	m.client = client
	return m.client, nil
}

func (m *RouterManager) RunArgs(args []string) (*routeros.Reply, error) {
	client, err := m.getClient()
	if err != nil {
		return nil, err
	}
	return client.RunArgs(args)
}

type CacheManager struct {
	router *RouterManager
	mu     sync.RWMutex

	Health       map[string]string
	Leases       []map[string]string
	RoutingTables []map[string]string
	RoutingRules  []map[string]string
	BridgeHosts   map[string]string // MAC -> Interface
}

func NewCacheManager(router *RouterManager) *CacheManager {
	return &CacheManager{
		router:      router,
		Health:      make(map[string]string),
		BridgeHosts: make(map[string]string),
	}
}

func (c *CacheManager) StartPolling(ctx context.Context) {
	// Fast poll for health/resources
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.updateHealth()
			}
		}
	}()

	// Medium poll for state
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.updateLeases()
				c.updateRouting()
				c.updateBridgeHosts()
			}
		}
	}()

	// Initial fetch
	c.updateHealth()
	c.updateLeases()
	c.updateRouting()
	c.updateBridgeHosts()
}

func (c *CacheManager) updateHealth() {
	res, err := c.router.RunArgs([]string{"/system/resource/print"})
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(res.Re) > 0 {
		maps.Copy(c.Health, res.Re[0].Map)
	}
}

func (c *CacheManager) updateLeases() {
	res, err := c.router.RunArgs([]string{"/ip/dhcp-server/lease/print"})
	if err != nil {
		return
	}
	var leases []map[string]string
	for _, re := range res.Re {
		leases = append(leases, re.Map)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Leases = leases
}

func (c *CacheManager) updateRouting() {
	resTables, err1 := c.router.RunArgs([]string{"/routing/table/print"})
	resRules, err2 := c.router.RunArgs([]string{"/routing/rule/print"})

	if err1 != nil || err2 != nil {
		return
	}

	var tables []map[string]string
	for _, re := range resTables.Re {
		tables = append(tables, re.Map)
	}

	var rules []map[string]string
	for _, re := range resRules.Re {
		rules = append(rules, re.Map)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.RoutingTables = tables
	c.RoutingRules = rules
}

func (c *CacheManager) updateBridgeHosts() {
	res, err := c.router.RunArgs([]string{"/interface/bridge/host/print"})
	if err != nil {
		return
	}
	hosts := make(map[string]string)
	for _, re := range res.Re {
		mac := re.Map["mac-address"]
		if mac != "" {
			hosts[mac] = re.Map["on-interface"]
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.BridgeHosts = hosts
}

func (c *CacheManager) GetIPInfo(userIP string) (map[string]string, string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var lease map[string]string
	for _, l := range c.Leases {
		if l["address"] == userIP {
			lease = l
			break
		}
	}

	if lease == nil {
		return nil, "", false
	}

	mac := lease["active-mac-address"]
	if mac == "" {
		mac = lease["mac-address"]
	}

	bridgePort := c.BridgeHosts[mac]
	return lease, bridgePort, true
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

	router := NewRouterManager(config, handler)
	cache := NewCacheManager(router)
	cache.StartPolling(context.Background())

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

		cache.mu.RLock()
		tables := cache.RoutingTables
		cache.mu.RUnlock()

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"data":   tables,
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

			_, err = router.RunArgs([]string{"/routing/rule/set", "=.id=" + data[".id"], "=table=" + data["table"]})
			if err != nil {
				log.Println("Operation failed", err)
				writeJSONError(w, http.StatusBadGateway, "failed to update rule")
				return
			}
			// Trigger immediate update
			go cache.updateRouting()
		}

		cache.mu.RLock()
		allRules := cache.RoutingRules
		cache.mu.RUnlock()

		var ipRule map[string]any

		for _, v := range allRules {
			if v["src-address"] == userIP+"/32" &&
				v["action"] == "lookup" &&
				v["dst-address"] == "" &&
				v["interface"] == "" &&
				v["routing-mark"] == "" &&
				v["chain"] == "" {

				ipRule = map[string]any{
					".id":         v[".id"],
					"src-address": v["src-address"],
					"disabled":    v["disabled"],
					"table":       v["table"],
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

		lease, bridgePort, ok := cache.GetIPInfo(userIP)
		if !ok {
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

		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"data": map[string]any{
				"user-ip":     userIP,
				"bridge-port": bridgePort,
				"lease":       lease,
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

		// Use cache for existence check
		lease, _, ok := cache.GetIPInfo(userIP)
		if !ok {
			writeJSONError(w, http.StatusNotFound, "lease not found")
			return
		}

		leaseId := lease[".id"]
		leaseDynamic := lease["dynamic"]

		if leaseDynamic == "false" {
			writeJSONError(w, http.StatusConflict, "lease is not dynamic")
			return
		}

		_, err = router.RunArgs([]string{"/ip/dhcp-server/lease/make-static", "=.id=" + leaseId})
		if err != nil {
			log.Println("Operation failed", err)
			writeJSONError(w, http.StatusBadGateway, "failed to make lease static")
			return
		}

		// Trigger immediate update and verify
		cache.updateLeases()

		lease, _, ok = cache.GetIPInfo(userIP)
		if !ok || lease["dynamic"] == "true" {
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

		cache.mu.RLock()
		info := make(map[string]string)
		maps.Copy(info, cache.Health)
		cache.mu.RUnlock()

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"version": Version,
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
