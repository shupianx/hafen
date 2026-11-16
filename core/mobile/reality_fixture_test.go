package mobile

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Opt-in local Reality server: only fixed echo and DoH destinations are allowed.
func TestRealityFixture(t *testing.T) {
	path := os.Getenv("HAFEN_REALITY_FIXTURE")
	if path == "" {
		t.Skip("explicit emulator fixture only")
	}
	_, _, certificate := testCertificate(t)
	handshake := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("fixture")) }))
	handshake.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS13, CurvePreferences: []tls.CurveID{tls.X25519}, NextProtos: []string{"h2", "http/1.1"}}
	handshake.EnableHTTP2 = true
	handshake.StartTLS()
	defer handshake.Close()
	echo := testEcho(t)
	udp, e := net.ListenPacket("udp4", echo)
	if e != nil {
		t.Fatal(e)
	}
	defer udp.Close()
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
	echoPort := echo[strings.LastIndex(echo, ":")+1:]
	key, _ := ecdh.X25519().GenerateKey(rand.Reader)
	secret := make([]byte, 16)
	rand.Read(secret)
	secret[6] = (secret[6] & 15) | 64
	secret[8] = (secret[8] & 63) | 128
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", secret[:4], secret[4:6], secret[6:8], secret[8:10], secret[10:])
	echoPortNumber, _ := strconv.Atoi(echoPort)
	port := 29393
	p := profile{Type: "vless", Server: "10.0.2.2.sslip.io", ServerPort: uint16(port), UUID: uuid, ServerName: "proxy.test", Fingerprint: "chrome", Flow: "xtls-rprx-vision", Reality: &profileReality{PublicKey: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), ShortID: "abcd"}}
	testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{map[string]any{"type": "vless", "tag": "vless", "listen": "127.0.0.1", "listen_port": port, "users": []any{map[string]any{"uuid": uuid, "flow": p.Flow}}, "tls": map[string]any{"enabled": true, "server_name": p.ServerName, "reality": map[string]any{"enabled": true, "private_key": base64.RawURLEncoding.EncodeToString(key.Bytes()), "short_id": []string{"abcd"}, "handshake": map[string]any{"server": "127.0.0.1", "server_port": handshake.Listener.Addr().(*net.TCPAddr).Port}}}}}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"rules": []any{
		map[string]any{"ip_cidr": "198.18.0.1/32", "port": 29392, "action": "route", "outbound": "direct", "override_address": "127.0.0.1", "override_port": echoPortNumber},
		map[string]any{"ip_cidr": "1.1.1.1/32", "port": 443, "action": "route", "outbound": "direct"},
		map[string]any{"action": "reject"},
	}}})
	local := p
	local.Server = "127.0.0.1"
	var clientConfig map[string]any
	json.Unmarshal(profileConfig(local), &clientConfig)
	client := testInstance(t, clientConfig)
	if err := relay(t, client, "198.18.0.1:29392"); err != nil {
		t.Fatal("fixture cannot relay", err)
	}
	t.Log("Reality fixture host TCP relay verified")
	raw, _ := json.Marshal(p)
	if e := os.WriteFile(path, raw, 0600); e != nil {
		t.Fatal(e)
	}
	defer os.Remove(path)
	t.Log("Reality fixture ready; stops after five minutes")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case <-time.After(5 * time.Minute):
	}
}
