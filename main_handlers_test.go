package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-routeros/routeros/v3"
	"github.com/go-routeros/routeros/v3/proto"
)

type fakeRouter struct {
	calls *[][]string
	run   func(args []string) (*routeros.Reply, error)
}

func (f fakeRouter) RunArgs(args []string) (*routeros.Reply, error) {
	*f.calls = append(*f.calls, args)
	return f.run(args)
}

func replyWith(rows ...map[string]string) *routeros.Reply {
	r := &routeros.Reply{}
	for _, row := range rows {
		r.Re = append(r.Re, &proto.Sentence{Word: "!re", Map: row})
	}
	return r
}

func newTestServer(t *testing.T, run func(args []string) (*routeros.Reply, error)) (http.Handler, *[][]string) {
	t.Helper()
	calls := &[][]string{}
	var config Config
	config.Features.PortMapping = true
	// The handlers may refresh the cache in the background, so give it a router
	// that fails fast instead of nil.
	var routerConfig Config
	routerConfig.Router.Host = "127.0.0.1"
	routerConfig.Router.Port = 1
	cache := NewCacheManager(NewRouterManager(routerConfig, nil))
	return newMux(config, fakeRouter{calls: calls, run: run}, cache), calls
}

func doRequest(mux http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "192.168.88.50:1234"
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestPortMappingRejectsForeignRule(t *testing.T) {
	mux, _ := newTestServer(t, func(args []string) (*routeros.Reply, error) {
		return replyWith(map[string]string{".id": "*1", "to-addresses": "10.0.0.1"}), nil
	})

	rr := doRequest(mux, http.MethodPut, "/api/port-mapping", `{".id":"*1","disabled":"true"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body: %s", rr.Code, rr.Body.String())
	}
}

func TestPortMappingRejectsActivePortConflict(t *testing.T) {
	mux, calls := newTestServer(t, func(args []string) (*routeros.Reply, error) {
		if args[0] == "/ip/firewall/nat/print" {
			return replyWith(map[string]string{"disabled": "false", "protocol": "tcp", "dst-port": "8080"}), nil
		}
		return &routeros.Reply{}, nil
	})

	rr := doRequest(mux, http.MethodPost, "/api/port-mapping", `{"protocol":"tcp","externalPort":"8080","internalPort":"80"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409; body: %s", rr.Code, rr.Body.String())
	}
	for _, call := range *calls {
		if call[0] == "/ip/firewall/nat/add" {
			t.Fatal("rule was added despite the conflict")
		}
	}
}

func TestPortMappingAllowsDisabledPortReuse(t *testing.T) {
	mux, calls := newTestServer(t, func(args []string) (*routeros.Reply, error) {
		if args[0] == "/ip/firewall/nat/print" {
			return replyWith(map[string]string{"disabled": "true", "protocol": "tcp", "dst-port": "8080"}), nil
		}
		return &routeros.Reply{}, nil
	})

	rr := doRequest(mux, http.MethodPost, "/api/port-mapping", `{"protocol":"tcp","externalPort":"8080","internalPort":"80"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body: %s", rr.Code, rr.Body.String())
	}
	added := false
	for _, call := range *calls {
		if call[0] == "/ip/firewall/nat/add" {
			added = true
		}
	}
	if !added {
		t.Fatal("expected the rule to be added")
	}
}

func TestIPRuleRejectsForeignRule(t *testing.T) {
	mux, _ := newTestServer(t, func(args []string) (*routeros.Reply, error) {
		return replyWith(map[string]string{".id": "*5", "src-address": "10.0.0.1/32"}), nil
	})

	rr := doRequest(mux, http.MethodPost, "/api/ip-rule", `{".id":"*5","table":"main"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body: %s", rr.Code, rr.Body.String())
	}
}

func TestIPRuleUpdatesOwnRule(t *testing.T) {
	mux, calls := newTestServer(t, func(args []string) (*routeros.Reply, error) {
		if args[0] == "/routing/rule/print" {
			return replyWith(map[string]string{".id": "*5", "src-address": "192.168.88.50/32"}), nil
		}
		return &routeros.Reply{}, nil
	})

	rr := doRequest(mux, http.MethodPost, "/api/ip-rule", `{".id":"*5","table":"main"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body: %s", rr.Code, rr.Body.String())
	}
	updated := false
	for _, call := range *calls {
		if call[0] == "/routing/rule/set" {
			updated = true
		}
	}
	if !updated {
		t.Fatal("expected the rule to be updated")
	}
}
