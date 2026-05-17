package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestUserIP(t *testing.T) {
	tests := []struct {
		name          string
		remoteAddr    string
		xForwardedFor string
		expected      string
	}{
		{
			name:          "Basic RemoteAddr",
			remoteAddr:    "192.168.1.100:12345",
			xForwardedFor: "",
			expected:      "192.168.1.100",
		},
		{
			name:          "IPv6 RemoteAddr",
			remoteAddr:    "[2001:db8::1]:8080",
			xForwardedFor: "",
			expected:      "2001:db8::1",
		},
		{
			name:          "Missing Port in RemoteAddr",
			remoteAddr:    "10.0.0.5",
			xForwardedFor: "",
			expected:      "10.0.0.5", // net.SplitHostPort fails, returns full string
		},
		{
			name:          "Single X-Forwarded-For",
			remoteAddr:    "127.0.0.1:54321",
			xForwardedFor: "172.16.0.10",
			expected:      "172.16.0.10",
		},
		{
			name:          "Multiple X-Forwarded-For",
			remoteAddr:    "127.0.0.1:54321",
			xForwardedFor: "203.0.113.5, 198.51.100.10",
			expected:      "203.0.113.5",
		},
		{
			name:          "Whitespace in X-Forwarded-For",
			remoteAddr:    "127.0.0.1:54321",
			xForwardedFor: "  10.10.10.10  , 192.168.1.1",
			expected:      "10.10.10.10",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.xForwardedFor != "" {
				req.Header.Set("X-Forwarded-For", tt.xForwardedFor)
			}

			ip := requestUserIP(req)
			if ip != tt.expected {
				t.Errorf("requestUserIP() = %v, want %v", ip, tt.expected)
			}
		})
	}
}

func TestCacheManagerGetIPInfo(t *testing.T) {
	// Create a standalone cache manager without a real router connection
	cache := &CacheManager{
		Leases: []map[string]string{
			{
				"address":            "192.168.88.50",
				"mac-address":        "00:11:22:33:44:55",
				"active-mac-address": "",
				".id":                "*A",
				"dynamic":            "false",
			},
			{
				"address":            "192.168.88.51",
				"mac-address":        "AA:BB:CC:DD:EE:FF",
				"active-mac-address": "AA:BB:CC:DD:EE:FF",
				".id":                "*B",
				"dynamic":            "true",
			},
		},
		BridgeHosts: map[string]string{
			"00:11:22:33:44:55": "ether1",
			"AA:BB:CC:DD:EE:FF": "wlan1",
		},
	}

	t.Run("Existing IP with normal MAC", func(t *testing.T) {
		lease, port, ok := cache.GetIPInfo("192.168.88.50")
		if !ok {
			t.Fatalf("Expected to find info for 192.168.88.50")
		}
		if lease[".id"] != "*A" {
			t.Errorf("Expected lease ID *A, got %s", lease[".id"])
		}
		if port != "ether1" {
			t.Errorf("Expected bridge port ether1, got %s", port)
		}
	})

	t.Run("Existing IP with active-mac-address", func(t *testing.T) {
		lease, port, ok := cache.GetIPInfo("192.168.88.51")
		if !ok {
			t.Fatalf("Expected to find info for 192.168.88.51")
		}
		if lease[".id"] != "*B" {
			t.Errorf("Expected lease ID *B, got %s", lease[".id"])
		}
		if port != "wlan1" {
			t.Errorf("Expected bridge port wlan1, got %s", port)
		}
	})

	t.Run("Non-existing IP", func(t *testing.T) {
		_, _, ok := cache.GetIPInfo("10.0.0.1")
		if ok {
			t.Errorf("Did not expect to find info for 10.0.0.1")
		}
	})
}

func TestHandleHealth(t *testing.T) {
	// Create dummy config and cache
	var config Config
	config.Server.Host = "127.0.0.1"
	config.Server.Port = 8080

	cache := &CacheManager{
		Connected: true,
		Health: map[string]string{
			"platform":          "MikroTik",
			"board-name":        "hAP ac2",
			"architecture-name": "arm",
			"version":           "7.12.1",
			"uptime":            "1d2h3m",
		},
	}

	handler := handleHealth(config, cache)

	t.Run("Valid GET Request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		req.RemoteAddr = "192.168.88.250:54321" // Simulate a client IP
		rr := httptest.NewRecorder()

		handler.ServeHTTP(rr, req)

		if status := rr.Code; status != http.StatusOK {
			t.Errorf("handler returned wrong status code: got %v want %v", status, http.StatusOK)
		}

		var response map[string]any
		if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
			t.Fatalf("Failed to decode response JSON: %v", err)
		}

		if response["status"] != "ok" {
			t.Errorf("Expected status 'ok', got %v", response["status"])
		}

		if response["connected"] != true {
			t.Errorf("Expected connected true, got %v", response["connected"])
		}

		data, ok := response["data"].(map[string]any)
		if !ok {
			t.Fatalf("Expected data object in response")
		}

		if data["user-ip"] != "192.168.88.250" {
			t.Errorf("Expected user-ip 192.168.88.250, got %v", data["user-ip"])
		}

		info, ok := data["info"].(map[string]any)
		if !ok {
			t.Fatalf("Expected info object in data")
		}

		if info["board-name"] != "hAP ac2" {
			t.Errorf("Expected board-name 'hAP ac2', got %v", info["board-name"])
		}
	})

	t.Run("Invalid POST Request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/health", nil)
		rr := httptest.NewRecorder()

		handler.ServeHTTP(rr, req)

		if status := rr.Code; status != http.StatusMethodNotAllowed {
			t.Errorf("handler returned wrong status code for POST: got %v want %v", status, http.StatusMethodNotAllowed)
		}
	})
}
