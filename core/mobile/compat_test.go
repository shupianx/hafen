package mobile

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	D "github.com/miekg/dns"
	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/adapter/inbound"
	"github.com/sagernet/sing-box/option"
	"github.com/sagernet/sing-box/protocol/hysteria2"
	"github.com/sagernet/sing-box/protocol/trojan"
	"github.com/sagernet/sing-box/protocol/vless"
	boxjson "github.com/sagernet/sing/common/json"
	M "github.com/sagernet/sing/common/metadata"
	"github.com/sagernet/sing/service"
)

// Test-only registration keeps proxy servers out of the production registry.
func testInstance(t *testing.T, config map[string]any) *box.Box {
	t.Helper()
	ctx, cancel := context.WithCancel(coreContext())
	ctx = service.ContextWith[adapter.PlatformInterface](ctx, &diagnosticPlatform{})
	// The interface registry is exposed separately from the adapter interface.
	r := service.FromContext[adapter.InboundRegistry](ctx).(*inbound.Registry)
	trojan.RegisterInbound(r)
	hysteria2.RegisterInbound(r)
	vless.RegisterInbound(r)
	data, _ := json.Marshal(config)
	opts, e := boxjson.UnmarshalExtendedContext[option.Options](ctx, data)
	if e != nil {
		cancel()
		t.Fatal(e)
	}
	instance, e := box.New(box.Options{Options: opts, Context: ctx})
	if e != nil {
		cancel()
		t.Fatal(e)
	}
	t.Cleanup(func() { cancel(); instance.Close() })
	if e = instance.Start(); e != nil {
		t.Fatal(e)
	}
	return instance
}

func testPort(t *testing.T) int {
	t.Helper()
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}
func testEcho(t *testing.T) string {
	t.Helper()
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, e := l.Accept()
			if e != nil {
				return
			}
			go func() { defer c.Close(); c.SetDeadline(time.Now().Add(4 * time.Second)); io.Copy(c, c) }()
		}
	}()
	return l.Addr().String()
}
func testCertificate(t *testing.T) (string, string, tls.Certificate) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "proxy.test"}, DNSNames: []string{"proxy.test"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true}
	der, e := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := x509.MarshalPKCS8PrivateKey(key)
	certPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	keyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw}))
	cert, e := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if e != nil {
		t.Fatal(e)
	}
	return certPEM, keyPEM, cert
}
func relay(t *testing.T, client *box.Box, destination string) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, _ := client.Outbound().Outbound("proxy")
	c, e := out.DialContext(ctx, "tcp", M.ParseSocksaddr(destination))
	if e != nil {
		return e
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(3 * time.Second))
	data := []byte("hafen-transport-test")
	if _, e = c.Write(data); e != nil {
		return e
	}
	reply := make([]byte, len(data))
	_, e = io.ReadFull(c, reply)
	if e == nil && string(reply) != string(data) {
		t.Fatal("payload mismatch")
	}
	return e
}
func TestTransportRoundTrips(t *testing.T) {
	certPEM, keyPEM, certificate := testCertificate(t)
	echo := testEcho(t)
	handshake := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("decoy")) }))
	handshake.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS13, CurvePreferences: []tls.CurveID{tls.X25519}, NextProtos: []string{"h2", "http/1.1"}}
	handshake.EnableHTTP2 = true
	handshake.StartTLS()
	defer handshake.Close()
	key, _ := ecdh.X25519().GenerateKey(rand.Reader)
	for _, kind := range []string{"trojan", "vless"} {
		for _, mode := range []string{"tls", "ws", "grpc", "vision", "reality"} {
			if kind == "trojan" && (mode == "vision" || mode == "reality") {
				continue
			}
			t.Run(kind+"/"+mode, func(t *testing.T) {
				port := testPort(t)
				p := profile{Type: kind, Server: "127.0.0.1", ServerPort: uint16(port), ServerName: "proxy.test"}
				user := map[string]any{}
				if kind == "trojan" {
					p.Password = "test-only"
					user["password"] = p.Password
				} else {
					p.UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
					user["uuid"] = p.UUID
				}
				if mode == "ws" {
					p.Transport = &profileTransport{Type: "ws", Path: "/tunnel", Headers: map[string]string{"Host": "proxy.test"}}
				}
				if mode == "grpc" {
					p.Transport = &profileTransport{Type: "grpc", ServiceName: "Hafen"}
				}
				if mode == "vision" || mode == "reality" {
					p.Flow = "xtls-rprx-vision"
					user["flow"] = p.Flow
				}
				if mode == "reality" {
					p.Fingerprint = "chrome"
					p.Reality = &profileReality{PublicKey: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), ShortID: "0123456789abcdef"}
				}
				raw, _ := json.Marshal(p)
				if e := CheckProfile(string(raw)); e != nil {
					t.Fatal("construction", e)
				}
				var clientConfig map[string]any
				json.Unmarshal(profileConfig(p), &clientConfig)
				out := clientConfig["outbounds"].([]any)[0].(map[string]any)
				serverTLS := map[string]any{"enabled": true, "server_name": "proxy.test", "certificate": []string{certPEM}, "key": []string{keyPEM}}
				if mode == "reality" {
					serverTLS = map[string]any{"enabled": true, "server_name": "proxy.test", "reality": map[string]any{"enabled": true, "private_key": base64.RawURLEncoding.EncodeToString(key.Bytes()), "short_id": []string{p.Reality.ShortID}, "handshake": map[string]any{"server": "127.0.0.1", "server_port": handshake.Listener.Addr().(*net.TCPAddr).Port}}}
				} else {
					out["tls"].(map[string]any)["certificate"] = []string{certPEM}
				}
				in := map[string]any{"type": kind, "tag": "server", "listen": "127.0.0.1", "listen_port": port, "users": []any{user}, "tls": serverTLS}
				if tr, ok := out["transport"]; ok {
					in["transport"] = tr
				}
				testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{in}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct"}})
				client := testInstance(t, clientConfig)
				if e := relay(t, client, echo); e != nil {
					t.Fatal("real protocol echo", e)
				}
				if mode == "reality" {
					otherKey, _ := ecdh.X25519().GenerateKey(rand.Reader)
					out["tls"].(map[string]any)["reality"].(map[string]any)["public_key"] = base64.RawURLEncoding.EncodeToString(otherKey.PublicKey().Bytes())
					bad := testInstance(t, clientConfig)
					if relay(t, bad, echo) == nil {
						t.Fatal("wrong Reality public key accepted")
					}
				}
				// Trust failure must never downgrade to plain TCP or skip verification.
				if mode == "tls" {
					delete(out["tls"].(map[string]any), "certificate")
					bad := testInstance(t, clientConfig)
					if relay(t, bad, echo) == nil {
						t.Fatal("untrusted certificate accepted")
					}
				}
			})
		}
	}
}

type countingProtector struct {
	allow bool
	calls atomic.Int64
}

func (p *countingProtector) InterfaceName() string { return testProtector{}.InterfaceName() }
func (p *countingProtector) InterfaceIndex() int32 { return testProtector{}.InterfaceIndex() }
func (p *countingProtector) Protect(int32) bool    { p.calls.Add(1); return p.allow }
func TestProtectedBootstrap(t *testing.T) {
	echo := testEcho(t)
	port := testPort(t)
	testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{map[string]any{"type": "shadowsocks", "tag": "ss", "listen": "127.0.0.1", "listen_port": port, "method": "aes-128-gcm", "password": "test-only"}}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct"}})
	var queries atomic.Int64
	doh := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
		q := new(D.Msg)
		if q.Unpack(b) != nil {
			w.WriteHeader(400)
			return
		}
		queries.Add(1)
		answer := new(D.Msg)
		answer.SetReply(q)
		for _, question := range q.Question {
			if question.Name != "proxy.test." {
				t.Error("bootstrap received application DNS")
			}
			if question.Qtype == D.TypeA {
				answer.Answer = append(answer.Answer, &D.A{Hdr: D.RR_Header{Name: question.Name, Rrtype: D.TypeA, Class: D.ClassINET, Ttl: 60}, A: net.ParseIP("127.0.0.1")})
			}
		}
		raw, _ := answer.Pack()
		w.Header().Set("Content-Type", "application/dns-message")
		w.Write(raw)
	}))
	defer doh.Close()
	cert := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: doh.Certificate().Raw}))
	for _, allow := range []bool{true, false} {
		t.Run(strconv.FormatBool(allow), func(t *testing.T) {
			var config map[string]any
			json.Unmarshal(tunnelConfig(profile{Type: "shadowsocks", Server: "proxy.test", ServerPort: uint16(port), Method: "aes-128-gcm", Password: "test-only"}), &config)
			dns := config["dns"].(map[string]any)
			servers := dns["servers"].([]any)
			if dns["final"] != "remote" || servers[1].(map[string]any)["detour"] != "proxy" {
				t.Fatal("application DNS policy lost")
			}
			bootstrap := servers[0].(map[string]any)
			bootstrap["server"] = "127.0.0.1"
			bootstrap["server_port"] = doh.Listener.Addr().(*net.TCPAddr).Port
			bootstrap["tls"] = map[string]any{"enabled": true, "server_name": "example.com", "certificate": []string{cert}}
			b, _ := json.Marshal(config)
			protector := &countingProtector{allow: allow}
			before := queries.Load()
			session, e := newPacketSession(b, protector)
			if e != nil {
				t.Fatal(e)
			}
			defer session.Close()
			e = relay(t, session.instance, echo)
			if allow {
				if e != nil || protector.calls.Load() < 2 || queries.Load() == before {
					t.Fatal("protected bootstrap did not relay", e)
				}
			} else {
				if e == nil || queries.Load() != before || protector.calls.Load() == 0 {
					t.Fatal("protection failure bypassed")
				}
			}
		})
	}
}

func TestSubscriptionTransportMapping(t *testing.T) {
	key, _ := ecdh.X25519().GenerateKey(rand.Reader)
	public := base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes())
	for _, kind := range []string{"trojan", "vless"} {
		for _, mode := range []string{"ws", "grpc", "reality"} {
			if mode == "reality" && kind != "vless" {
				continue
			}
			expected := profile{Type: kind, Server: "proxy.test", ServerPort: 443, ServerName: "proxy.test"}
			user := "test-only"
			clash := map[string]any{"name": "Test", "type": kind, "server": "proxy.test", "port": 443, "sni": "proxy.test", "tls": true}
			if kind == "vless" {
				user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
				expected.UUID = user
				clash["uuid"] = user
			} else {
				expected.Password = user
				clash["password"] = user
			}
			query := "security=tls&sni=proxy.test&type=" + mode
			switch mode {
			case "ws":
				expected.Transport = &profileTransport{Type: "ws", Path: "/tunnel", Headers: map[string]string{"Host": "cdn.test"}}
				clash["network"] = "ws"
				clash["ws-opts"] = map[string]any{"path": "/tunnel", "headers": map[string]string{"Host": "cdn.test"}}
				query += "&path=%2Ftunnel&host=cdn.test"
			case "grpc":
				expected.Transport = &profileTransport{Type: "grpc", ServiceName: "Hafen"}
				clash["network"] = "grpc"
				clash["grpc-opts"] = map[string]any{"grpc-service-name": "Hafen"}
				query += "&serviceName=Hafen"
			case "reality":
				expected.Fingerprint = "chrome"
				expected.Flow = "xtls-rprx-vision"
				expected.Reality = &profileReality{PublicKey: public, ShortID: "abcd"}
				clash["client-fingerprint"] = "chrome"
				clash["flow"] = expected.Flow
				clash["reality-opts"] = map[string]any{"public-key": public, "short-id": "abcd"}
				query = "security=reality&type=tcp&sni=proxy.test&fp=chrome&flow=xtls-rprx-vision&pbk=" + public + "&sid=abcd"
			}
			yaml, _ := json.Marshal(map[string]any{"proxies": []any{clash}})
			// Use the same core option serialization for an authentic sing-box input.
			var config map[string]any
			json.Unmarshal(profileConfig(expected), &config)
			singJSON, _ := json.Marshal(map[string]any{"outbounds": config["outbounds"]})
			uri := kind + "://" + user + "@proxy.test:443?" + query + "#Test"
			for _, raw := range []string{string(yaml), string(singJSON), uri} {
				bundle, e := ParseSubscription(raw)
				if e != nil {
					t.Fatalf("%s/%s: %v", kind, mode, e)
				}
				b, _ := readBundle(bundle)
				p, e := parseProfile(string(b.Nodes[0].Profile))
				if e != nil {
					t.Fatal(e)
				}
				left, _ := json.Marshal(expected)
				right, _ := json.Marshal(p)
				if string(left) != string(right) {
					t.Fatalf("mapping mismatch: %s/%s", kind, mode)
				}
			}
		}
	}
	for _, option := range []string{
		`"transport":{"type":"ws","path":"/","headers":{"Host":"x\r\nInjected: true"}}`,
		`"transport":{"type":"ws","path":"/","headers":{"Host":"a","host":"b"}}`,
		`"transport":{"type":"grpc","service_name":"test?redirect"}`,
		`"transport":{"type":"ws","path":"/"},"flow":"xtls-rprx-vision"`,
		`"reality":{"public_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","short_id":""}`,
		`"fingerprint":"unsupported"`,
	} {
		p := `{"type":"vless","server":"proxy.test","server_port":443,"uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",` + option + `}`
		if CheckProfile(p) == nil {
			t.Fatal("unsafe transport accepted")
		}
	}
}
