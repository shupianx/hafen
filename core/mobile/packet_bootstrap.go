package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"runtime/debug"
	"sync"
	"time"

	C "github.com/sagernet/sing-box/constant"
)

var packetRuntimeOnce sync.Once

func configurePacketRuntime() {
	if C.IsIos {
		packetRuntimeOnce.Do(func() {
			// Match the pinned libbox Apple extension GC policy: 80% of 50 MiB.
			// This is a Go soft budget, not a process-wide memory guarantee.
			debug.SetMemoryLimit(40 * 1024 * 1024)
			debug.SetGCPercent(50)
		})
	}
}

type endpointLookup func(context.Context, string, string) ([]netip.Addr, error)

// StartPacketSessionBeforeRoutes is for native iOS startup ONLY, before installing
// VPN routes/DNS. The Go iOS cgo resolver uses the system getaddrinfo resolver.
// Only the selected endpoint is resolved; application DNS still uses the proxy.
// Results live in this session, never in the saved profile, and refresh on reconnect.
func StartPacketSessionBeforeRoutes(content string, protector SocketProtector) (*PacketSession, error) {
	return newPacketSessionBeforeRoutes(content, protector, net.DefaultResolver.LookupNetIP)
}
func newPacketSessionBeforeRoutes(content string, protector SocketProtector, lookup endpointLookup) (*PacketSession, error) {
	p, err := parseProfile(content)
	if err != nil {
		return nil, err
	}
	// Reject missing network data before issuing even a system DNS query.
	if _, err = newPacketMonitor(protector); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	config, err := resolvedTunnelConfig(ctx, p, lookup)
	if err != nil {
		return nil, errors.New("ENDPOINT_DNS_FAILED")
	}
	s, err := newPacketSession(config, protector)
	if err != nil {
		return nil, errors.New("CORE_START_FAILED")
	}
	s.endpoint, s.endpointPort, s.endpointProtocol = p.Server, p.ServerPort, p.Type
	return s, nil
}
func resolvedTunnelConfig(ctx context.Context, p profile, lookup endpointLookup) ([]byte, error) {
	addresses := []netip.Addr{}
	if ip, err := netip.ParseAddr(p.Server); err == nil {
		addresses = append(addresses, ip)
	} else {
		var err error
		addresses, err = lookup(ctx, "ip", p.Server)
		if err != nil {
			return nil, err
		}
	}
	valid := make([]string, 0, len(addresses))
	for _, ip := range addresses {
		if !ip.IsValid() || ip.IsUnspecified() || ip.IsMulticast() {
			continue
		}
		valid = append(valid, ip.Unmap().String())
		if len(valid) == 16 {
			break
		}
	}
	if len(valid) == 0 {
		return nil, errors.New("DNS_EMPTY_RESPONSE")
	}
	var config map[string]any
	_ = json.Unmarshal(tunnelConfig(p), &config)
	servers := config["dns"].(map[string]any)["servers"].([]any)
	// Leave the original endpoint, TLS SNI, REALITY and transport Host untouched.
	// A bounded local hosts response replaces only bootstrap DNS network I/O.
	servers[0] = map[string]any{"type": "hosts", "tag": "bootstrap", "predefined": map[string]any{p.Server: valid}}
	return json.Marshal(config)
}
