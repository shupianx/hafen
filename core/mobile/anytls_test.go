package mobile

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestAnyTLSSubscriptionFormats(t *testing.T) {
	const uri = "anytls://demo%40p%3Ass@[2001:db8::1]/?sni=proxy.test&insecure=0#Any%20TLS"
	expected := profile{Type: "anytls", Server: "2001:db8::1", ServerPort: 443, Password: "demo@p:ss", ServerName: "proxy.test"}
	for _, text := range []string{
		uri, base64.StdEncoding.EncodeToString([]byte(uri)),
		`proxies: [{type: anytls, name: Any TLS, server: "2001:db8::1", port: 443, password: "demo@p:ss", sni: proxy.test, skip-cert-verify: false}]`,
		`{"outbounds":[{"type":"anytls","tag":"Any TLS","server":"2001:db8::1","server_port":443,"password":"demo@p:ss","tls":{"enabled":true,"server_name":"proxy.test"}}]}`,
	} {
		raw, err := ParseSubscription(text)
		if err != nil {
			t.Fatal(err)
		}
		b, err := readBundle(raw)
		if err != nil || len(b.Nodes) != 1 || b.Skipped != 0 || b.Nodes[0].Name != "Any TLS" {
			t.Fatal("lost AnyTLS subscription node", err)
		}
		stored, err := SubscriptionProfile(raw, b.Revision, b.Nodes[0].ID)
		if err != nil {
			t.Fatal(err)
		}
		if p, err := parseProfile(stored); err != nil || !reflect.DeepEqual(p, expected) {
			t.Fatal("incorrect AnyTLS profile", err)
		}
		summary, err := SubscriptionSummary(raw)
		if err != nil || strings.Contains(summary, expected.Password) {
			t.Fatal("invalid AnyTLS summary", err)
		}
	}
}

func TestAnyTLSStructuredTLSOptions(t *testing.T) {
	for _, text := range []string{
		`proxies: [{type: anytls, server: proxy.test, port: 1443, password: fixture, alpn: [h2, http/1.1], client-fingerprint: chrome}]`,
		`{"outbounds":[{"type":"anytls","server":"proxy.test","server_port":1443,"password":"fixture","tls":{"enabled":true,"alpn":["h2","http/1.1"],"utls":{"enabled":true,"fingerprint":"chrome"}}}]}`,
	} {
		raw, err := ParseSubscription(text)
		if err != nil {
			t.Fatal(err)
		}
		b, err := readBundle(raw)
		if err != nil {
			t.Fatal(err)
		}
		p, err := parseProfile(string(b.Nodes[0].Profile))
		if err != nil || p.ServerPort != 1443 || p.Fingerprint != "chrome" || !reflect.DeepEqual(p.ALPN, []string{"h2", "http/1.1"}) {
			t.Fatal("AnyTLS TLS parameters changed", err)
		}
	}
}

func TestAnyTLSExporterURI(t *testing.T) {
	raw, err := ParseSubscription("anytls://fixture@proxy.test:1443?type=tcp&sni=tls.test&fp=chrome&pcs=&insecure=0#Demo")
	if err != nil {
		t.Fatal(err)
	}
	b, err := readBundle(raw)
	if err != nil || len(b.Nodes) != 1 || b.Skipped != 0 {
		t.Fatal("expected one imported node", err)
	}
	p, err := parseProfile(string(b.Nodes[0].Profile))
	if err != nil || p.Fingerprint != "chrome" || p.ServerName != "tls.test" {
		t.Fatal("exporter TLS options lost", err)
	}
}

func TestAnyTLSRejectsUnsupportedOptions(t *testing.T) {
	for _, text := range []string{
		"anytls://SECRET@proxy.test?insecure=1",
		"anytls://SECRET@proxy.test?sni=a&sni=b",
		"anytls://SECRET@proxy.test?unknown=1",
		"anytls://SECRET@proxy.test?type=ws",
		"anytls://SECRET@proxy.test?pcs=nonempty",
		"anytls://SECRET@proxy.test?fp=unsupported",
		"anytls://SECRET@proxy.test:0",
		"anytls://SECRET@proxy.test:",
		"anytls://user:SECRET@proxy.test",
		"anytls://%FF@proxy.test",
		"anytls://@proxy.test",
		`proxies: [{type: anytls, server: proxy.test, port: 443, password: SECRET, skip-cert-verify: true}]`,
		`proxies: [{type: anytls, server: proxy.test, port: 443, password: SECRET, network: ws}]`,
		`proxies: [{type: anytls, server: proxy.test, port: 443, password: SECRET, min-idle-session: 3}]`,
		`{"outbounds":[{"type":"anytls","server":"proxy.test","server_port":443,"password":"SECRET","tls":{"enabled":false}}]}`,
		`{"outbounds":[{"type":"anytls","server":"proxy.test","server_port":443,"password":"SECRET","tls":{"enabled":true,"insecure":true}}]}`,
	} {
		if _, err := ParseSubscription(text); err == nil || err.Error() != "NO_SUPPORTED_NODES" {
			t.Fatal("unsupported AnyTLS node must be skipped")
		}
	}
	for _, field := range []string{`"transport":{"type":"ws"}`, `"flow":"xtls-rprx-vision"`, `"uuid":"invalid"`, `"up_mbps":1`} {
		if CheckProfile(`{"type":"anytls","server":"proxy.test","server_port":443,"password":"SECRET",`+field+`}`) == nil {
			t.Fatal("unsupported AnyTLS profile accepted")
		}
	}
}

func TestImportedAnyTLSRelay(t *testing.T) {
	cert, key, _ := testCertificate(t)
	port := testPort(t)
	testInstance(t, map[string]any{
		"inbounds": []any{map[string]any{
			"type": "anytls", "listen": "127.0.0.1", "listen_port": port,
			"users": []any{map[string]any{"name": "test", "password": "fixture"}},
			"tls":   map[string]any{"enabled": true, "certificate": []string{cert}, "key": []string{key}},
		}},
		"outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}},
	})
	echo := testEcho(t)
	for _, tc := range []struct {
		name, input               string
		trustFixture, expectRelay bool
	}{
		{"uri", "anytls://fixture@127.0.0.1:%d?sni=proxy.test", true, true},
		{"clash", `proxies: [{type: anytls, server: "127.0.0.1", port: %d, password: fixture, sni: proxy.test}]`, true, true},
		{"sing-box", `{"outbounds":[{"type":"anytls","server":"127.0.0.1","server_port":%d,"password":"fixture","tls":{"enabled":true,"server_name":"proxy.test"}}]}`, true, true},
		{"bad-password", "anytls://wrong@127.0.0.1:%d?sni=proxy.test", true, false},
		{"wrong-name", "anytls://fixture@127.0.0.1:%d?sni=other.test", true, false},
		{"untrusted", "anytls://fixture@127.0.0.1:%d?sni=proxy.test", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := ParseSubscription(fmt.Sprintf(tc.input, port))
			if err != nil {
				t.Fatal(err)
			}
			b, err := readBundle(raw)
			if err != nil {
				t.Fatal(err)
			}
			p, err := parseProfile(string(b.Nodes[0].Profile))
			if err != nil {
				t.Fatal(err)
			}
			var config map[string]any
			if err := json.Unmarshal(profileConfig(p), &config); err != nil {
				t.Fatal(err)
			}
			if tc.trustFixture {
				// Trust the isolated fixture CA through the test configuration only.
				out := config["outbounds"].([]any)[0].(map[string]any)
				out["tls"].(map[string]any)["certificate"] = []string{cert}
			}
			err = relay(t, testInstance(t, config), echo)
			if (err == nil) != tc.expectRelay {
				t.Fatal("unexpected relay result", err)
			}
		})
	}
}
