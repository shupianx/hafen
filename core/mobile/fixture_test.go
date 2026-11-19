package mobile

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	M "github.com/sagernet/sing/common/metadata"
	"io"
	"net"
	"os"
	"os/signal"
	"syscall"
	"testing"
	"time"
)

// Explicit, bounded emulator-only fixture. It is not linked into mobile builds.
func TestTunnelFixture(t *testing.T) {
	path := os.Getenv("HAFEN_TUNNEL_FIXTURE")
	if path == "" {
		t.Skip("explicit emulator fixture only")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	password := hex.EncodeToString(secret)
	tcp, err := net.Listen("tcp4", "127.0.0.1:29392")
	if err != nil {
		t.Fatal(err)
	}
	defer tcp.Close()
	udp, err := net.ListenPacket("udp4", "127.0.0.1:29392")
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	go func() {
		for {
			c, e := tcp.Accept()
			if e != nil {
				return
			}
			go func() { defer c.Close(); c.SetDeadline(time.Now().Add(5 * time.Second)); io.Copy(c, c) }()
		}
	}()
	go func() {
		b := make([]byte, 1500)
		for {
			n, a, e := udp.ReadFrom(b)
			if e != nil {
				return
			}
			udp.WriteTo(b[:n], a)
		}
	}()
	config, _ := json.Marshal(map[string]any{
		"log": map[string]any{"level": "debug", "timestamp": true},
		"inbounds": []any{
			map[string]any{"type": "shadowsocks", "tag": "ss", "listen": "127.0.0.1", "listen_port": 29391, "method": "aes-128-gcm", "password": password},
			// A distinct endpoint for actual connected-node switching tests.
			map[string]any{"type": "shadowsocks", "tag": "ss-switch", "listen": "127.0.0.1", "listen_port": 29393, "method": "aes-128-gcm", "password": password},
		},
		"outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}},
		"route": map[string]any{"rules": []any{
			map[string]any{"ip_cidr": "198.18.0.1/32", "port": 29392, "action": "route", "outbound": "direct", "override_address": "127.0.0.1"},
			map[string]any{"ip_cidr": "1.1.1.1/32", "port": 443, "action": "route", "outbound": "direct"},
			map[string]any{"action": "reject"},
		}},
	})
	server, cancel, err := newInstance(config)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	defer server.Close()
	if err = server.Start(); err != nil {
		t.Fatal(err)
	}
	client, clientCancel, err := newInstance(profileConfig(profile{Type: "shadowsocks", Server: "127.0.0.1", ServerPort: 29391, Method: "aes-128-gcm", Password: password}))
	if err != nil {
		t.Fatal(err)
	}
	defer clientCancel()
	defer client.Close()
	if err = client.Start(); err != nil {
		t.Fatal(err)
	}
	outbound, _ := client.Outbound().Outbound("proxy")
	conn, err := outbound.DialContext(context.Background(), "tcp", M.ParseSocksaddr("198.18.0.1:29392"))
	if err != nil {
		t.Fatal(err)
	}
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	conn.Write([]byte("fixture-check"))
	reply := make([]byte, 13)
	if _, err = io.ReadFull(conn, reply); err != nil || string(reply) != "fixture-check" {
		t.Fatal("fixture cannot relay", err)
	}
	conn.Close()
	t.Log("fixture proxy TCP relay verified")
	profile, _ := json.Marshal(map[string]any{"type": "shadowsocks", "server": "10.0.2.2", "server_port": 29391, "method": "aes-128-gcm", "password": password})
	if err = os.WriteFile(path, profile, 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	t.Log("fixture ready; local TCP/UDP and Cloudflare DoH only; stops after 5 minutes")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case <-time.After(5 * time.Minute):
	}
}
