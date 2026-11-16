package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"reflect"
	"strings"
	"testing"
)

func TestResolvedEndpointRelayAndProtection(t *testing.T) {
	echo := testEcho(t)
	port := testPort(t)
	testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{map[string]any{"type": "shadowsocks", "tag": "ss", "listen": "127.0.0.1", "listen_port": port, "method": "aes-128-gcm", "password": "fixture"}}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct"}})
	raw, _ := json.Marshal(profile{Type: "shadowsocks", Server: "node.invalid", ServerPort: uint16(port), Method: "aes-128-gcm", Password: "fixture"})
	for _, allow := range []bool{true, false} {
		calls := 0
		protector := &countingProtector{allow: allow}
		session, err := newPacketSessionBeforeRoutes(string(raw), protector, func(ctx context.Context, network, host string) ([]netip.Addr, error) {
			calls++
			if host != "node.invalid" {
				t.Error("resolved an unrelated hostname")
			}
			if _, ok := ctx.Deadline(); !ok {
				t.Error("unbounded startup DNS")
			}
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		err = relay(t, session.instance, echo)
		session.Close()
		if allow && err != nil {
			t.Fatal(err)
		}
		if !allow && err == nil {
			t.Fatal("bypassed socket protection")
		}
		if calls != 1 || protector.calls.Load() == 0 {
			t.Fatal("missing startup DNS/socket protection")
		}
	}
}
func TestResolvedEndpointPreservesProxyTLS(t *testing.T) {
	p := profile{Type: "trojan", Server: "node.invalid", ServerPort: 443, Password: "fixture", ServerName: "sni.invalid", Transport: &profileTransport{Type: "ws", Path: "/proxy", Headers: map[string]string{"Host": "host.invalid"}}}
	// Inspect actual generated outbound: changing only bootstrap must preserve SNI,
	// endpoint domain and transport Host instead of replacing server with an IP.
	var original, updated map[string]any
	_ = json.Unmarshal(tunnelConfig(p), &original)
	raw, err := resolvedTunnelConfig(context.Background(), p, func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("2001:db8::1"), netip.MustParseAddr("192.0.2.1")}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(raw, &updated)
	if !reflect.DeepEqual(original["outbounds"], updated["outbounds"]) {
		t.Fatal("DNS replacement changed proxy/TLS settings")
	}
	dns := updated["dns"].(map[string]any)
	if dns["final"] != "remote" || dns["servers"].([]any)[1].(map[string]any)["detour"] != "proxy" {
		t.Fatal("application DNS lost proxy")
	}
}
func TestResolvedEndpointFailureAndLiteral(t *testing.T) {
	raw := `{"type":"shadowsocks","server":"node.invalid","server_port":443,"method":"aes-128-gcm","password":"fixture"}`
	_, err := newPacketSessionBeforeRoutes(raw, testProtector{true}, func(context.Context, string, string) ([]netip.Addr, error) {
		return nil, errors.New("secret node details")
	})
	if err == nil || err.Error() != "ENDPOINT_DNS_FAILED" || strings.Contains(err.Error(), "secret") {
		t.Fatal("startup DNS error was not sanitized")
	}
	p := profile{Type: "shadowsocks", Server: "192.0.2.1", ServerPort: 443, Method: "aes-128-gcm", Password: "fixture"}
	if _, err = resolvedTunnelConfig(context.Background(), p, func(context.Context, string, string) ([]netip.Addr, error) {
		t.Fatal("literal IP triggered DNS")
		return nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	p.Server = "node.invalid"
	if _, err = resolvedTunnelConfig(context.Background(), p, func(context.Context, string, string) ([]netip.Addr, error) { return nil, nil }); err == nil {
		t.Fatal("empty answer accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = resolvedTunnelConfig(ctx, p, func(ctx context.Context, _, _ string) ([]netip.Addr, error) { return nil, ctx.Err() }); !errors.Is(err, context.Canceled) {
		t.Fatal("lost cancellation")
	}
}
