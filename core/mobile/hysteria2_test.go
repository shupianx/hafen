package mobile

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	M "github.com/sagernet/sing/common/metadata"
)

func TestHysteria2SubscriptionFormats(t *testing.T) {
	const hy = "hysteria2://user%3Apass@proxy.test:443/?sni=proxy.test&obfs=salamander&obfs-password=obfs-secret&upmbps=10&downmbps=20&alpn=h3"
	texts := []string{
		hy, strings.Replace(hy, "hysteria2://", "hy2://", 1), base64.StdEncoding.EncodeToString([]byte(hy)),
		`proxies: [{name: HY2, type: hysteria2, server: proxy.test, port: 443, password: "user:pass", sni: proxy.test, obfs: salamander, obfs-password: obfs-secret, up: "10 Mbps", down: 20, alpn: [h3], skip-cert-verify: false, udp: true}]`,
		`{"outbounds":[{"type":"hysteria2","tag":"HY2","server":"proxy.test","server_port":443,"password":"user:pass","up_mbps":10,"down_mbps":20,"obfs":{"type":"salamander","password":"obfs-secret"},"tls":{"enabled":true,"server_name":"proxy.test","alpn":["h3"],"insecure":false}}]}`,
	}
	var expected string
	for i, text := range texts {
		raw, e := ParseSubscription(text)
		if e != nil {
			t.Fatalf("format %d: %v", i, e)
		}
		b, _ := readBundle(raw)
		p := string(b.Nodes[0].Profile)
		if i == 0 {
			expected = p
		} else if p != expected {
			t.Fatal("formats disagree")
		}
		summary, e := SubscriptionSummary(raw)
		if e != nil || strings.Contains(summary, "obfs-secret") || strings.Contains(summary, "user:pass") || strings.Contains(summary, "proxy.test") {
			t.Fatal("summary leaked credentials")
		}
		if _, e = SubscriptionProfile(raw, b.Revision, b.Nodes[0].ID); e != nil {
			t.Fatal(e)
		}
	}
	raw, e := ParseSubscription("hy2://user:pass@proxy.test?insecure=false&pinSHA256=&mport=")
	if e != nil {
		t.Fatal(e)
	}
	b, _ := readBundle(raw)
	p, e := parseProfile(string(b.Nodes[0].Profile))
	if e != nil || p.ServerPort != 443 || p.Password != "user:pass" {
		t.Fatal("default port/userpass")
	}
	hash := strings.Repeat("ab", 32)
	raw, e = ParseSubscription("hy2://secret@proxy.test?pinSHA256=" + hash + "&mport=443,1000-1010")
	if e != nil {
		t.Fatal(e)
	}
	b, _ = readBundle(raw)
	p, e = parseProfile(string(b.Nodes[0].Profile))
	if e != nil || p.CertificateSHA256 != hash || strings.Join(p.ServerPorts, ",") != "443:443,1000:1010" {
		t.Fatal("pin/ports mapping")
	}
}
func TestHysteria2RejectsInvalidOptions(t *testing.T) {
	for _, query := range []string{"insecure=1", "allowInsecure=true", "insecure=0&insecure=1", "obfs=salamander", "obfs-password=orphan", "obfs=gecko&obfs-password=x", "pinSHA256=invalid", "mport=0-443", "mport=100-50", "mport=443,65536", "upmbps=-1", "downmbps=10001", "upmbps=NaN", "sni=a&sni=b", "alpn=h2", "unknown=", "ech=key"} {
		if _, e := ParseSubscription("hy2://SECRET@proxy.test:443?" + query); e == nil || strings.Contains(e.Error(), "SECRET") {
			t.Fatalf("accepted/leaked case %s", query)
		}
	}
	for _, extra := range []string{`"up_mbps":-1`, `"down_mbps":10001`, `"fingerprint":"chrome"`, `"transport":{"type":"ws"}`, `"flow":"xtls-rprx-vision"`, `"certificate_sha256":"invalid"`, `"server_ports":["0:65535"]`, `"hop_interval":"5s"`, `"server_ports":["443"],"hop_interval":"0s"`, `"obfs":{"type":"salamander","password":""}`} {
		if CheckProfile(`{"type":"hysteria2","server":"proxy.test","server_port":443,"password":"SECRET",`+extra+`}`) == nil {
			t.Fatal("accepted invalid profile")
		}
	}
	for _, node := range []string{
		`{"type":"hysteria2","server":"proxy.test","server_port":443,"password":"x","tls":{"enabled":true,"insecure":true}}`,
		`{"type":"hysteria2","server":"proxy.test","server_port":443,"password":"x","tls":{"enabled":true,"utls":{"enabled":true}}}}`,
		`{"type":"hysteria2","server":"proxy.test","server_port":443,"password":"x","tls":{"enabled":true},"network":"tcp"}`,
		`{"type":"hysteria2","server":"proxy.test","server_port":443,"password":"x","tls":{"enabled":true},"obfs":null}`,
	} {
		if _, e := ParseSubscription(`{"outbounds":[` + node + `]}`); e == nil {
			t.Fatal("unsafe/unsupported JSON")
		}
	}
	// Newly added fields must not silently change other protocols.
	if CheckProfile(`{"type":"trojan","server":"proxy.test","server_port":443,"password":"x","up_mbps":10}`) == nil {
		t.Fatal("HY2 field accepted for Trojan")
	}
}
func udpTestPort(t *testing.T) int {
	t.Helper()
	c, e := net.ListenPacket("udp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

// Two UDP front ports forward to the SAME QUIC server, matching port-hop NAT.
func hopForwarder(t *testing.T, backend int) int {
	t.Helper()
	front, e := net.ListenPacket("udp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		conns := map[string]*net.UDPConn{}
		defer func() {
			for _, c := range conns {
				c.Close()
			}
		}()
		b := make([]byte, 65535)
		for {
			n, a, e := front.ReadFrom(b)
			if e != nil {
				return
			}
			c := conns[a.String()]
			if c == nil {
				c, e = net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: backend})
				if e != nil {
					return
				}
				conns[a.String()] = c
				wg.Add(1)
				go func(c *net.UDPConn, a net.Addr) {
					defer wg.Done()
					reply := make([]byte, 65535)
					for {
						n, e := c.Read(reply)
						if e != nil {
							return
						}
						front.WriteTo(reply[:n], a)
					}
				}(c, a)
			}
			c.Write(b[:n])
		}
	}()
	t.Cleanup(func() { front.Close(); wg.Wait() })
	return front.LocalAddr().(*net.UDPAddr).Port
}
func TestHysteria2RoundTrips(t *testing.T) {
	cert, key, certificate := testCertificate(t)
	hash := sha256.Sum256(certificate.Certificate[0])
	pin := hex.EncodeToString(hash[:])
	echo := testEcho(t)
	udp, e := net.ListenPacket("udp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer udp.Close()
	go func() {
		b := make([]byte, 2048)
		for {
			n, a, e := udp.ReadFrom(b)
			if e != nil {
				return
			}
			udp.WriteTo(b[:n], a)
		}
	}()
	for _, mode := range []string{"plain", "salamander", "pin", "pin-salamander", "port-hopping"} {
		t.Run(mode, func(t *testing.T) {
			port := udpTestPort(t)
			p := profile{Type: "hysteria2", Server: "127.0.0.1", ServerPort: uint16(port), ServerName: "proxy.test", Password: "test-only"}
			ports := []int{port}
			if strings.Contains(mode, "pin") || mode == "port-hopping" {
				p.CertificateSHA256 = pin
			}
			if strings.Contains(mode, "salamander") {
				p.Obfs = &profileObfs{Type: "salamander", Password: "obfs-only"}
				p.UpMbps = 10
				p.DownMbps = 20
			}
			if mode == "port-hopping" {
				p.ServerPorts = []string{fmt.Sprint(hopForwarder(t, port)), fmt.Sprint(hopForwarder(t, port))}
				p.HopInterval = "5s"
			}
			for _, port := range ports {
				in := map[string]any{"type": "hysteria2", "tag": "hy2", "listen": "127.0.0.1", "listen_port": port, "users": []any{map[string]any{"password": p.Password}}, "tls": map[string]any{"enabled": true, "certificate": []string{cert}, "key": []string{key}}}
				if p.Obfs != nil {
					in["obfs"] = p.Obfs
				}
				testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{in}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct"}})
			}
			raw, _ := json.Marshal(p)
			if e := CheckProfile(string(raw)); e != nil {
				t.Fatal("construction", e)
			}
			var config map[string]any
			json.Unmarshal(tunnelConfig(p), &config)
			proxy := config["outbounds"].([]any)[0].(map[string]any)
			tlsOptions := proxy["tls"].(map[string]any)
			tlsOptions["certificate"] = []string{cert}
			protector := &countingProtector{allow: true}
			start := func(protect *countingProtector) *PacketSession {
				t.Helper()
				data, _ := json.Marshal(config)
				s, e := newPacketSession(data, protect)
				if e != nil {
					t.Fatal(e)
				}
				t.Cleanup(func() { s.Close() })
				return s
			}
			s := start(protector)
			if e := relay(t, s.instance, echo); e != nil {
				t.Fatal("TCP", e)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			out, _ := s.instance.Outbound().Outbound("proxy")
			c, e := out.ListenPacket(ctx, M.ParseSocksaddr(udp.LocalAddr().String()))
			if e != nil {
				t.Fatal(e)
			}
			defer c.Close()
			c.SetDeadline(time.Now().Add(3 * time.Second))
			msg := []byte("hafen-hy2-udp")
			if _, e = c.WriteTo(msg, udp.LocalAddr()); e != nil {
				t.Fatal(e)
			}
			response := make([]byte, 1024)
			n, _, e := c.ReadFrom(response)
			if e != nil || string(response[:n]) != string(msg) {
				t.Fatal("UDP", e)
			}
			if protector.calls.Load() == 0 {
				t.Fatal("UDP socket bypassed protection")
			}
			if mode == "port-hopping" {
				before := protector.calls.Load()
				time.Sleep(6 * time.Second)
				if e := relay(t, s.instance, echo); e != nil {
					t.Fatal("after hop", e)
				}
				if protector.calls.Load() <= before {
					t.Fatal("hop did not protect a new socket")
				}
			}
			if mode == "pin" {
				proxy["certificate_sha256"] = strings.Repeat("00", 32)
				if relay(t, start(protector).instance, echo) == nil {
					t.Fatal("wrong certificate pin accepted")
				}
				proxy["certificate_sha256"] = pin
				delete(tlsOptions, "certificate")
				if relay(t, start(protector).instance, echo) == nil {
					t.Fatal("pin bypassed CA validation")
				}
				tlsOptions["certificate"] = []string{cert}
				proxy["password"] = "wrong-password"
				if relay(t, start(protector).instance, echo) == nil {
					t.Fatal("bad authentication accepted")
				}
				proxy["password"] = p.Password
				tlsOptions["server_name"] = "wrong.test"
				if relay(t, start(protector).instance, echo) == nil {
					t.Fatal("pin bypassed hostname validation")
				}
				tlsOptions["server_name"] = "proxy.test"
				denied := &countingProtector{allow: false}
				if relay(t, start(denied).instance, echo) == nil || denied.calls.Load() == 0 {
					t.Fatal("failed socket protection ignored")
				}
			}
		})
	}
}
