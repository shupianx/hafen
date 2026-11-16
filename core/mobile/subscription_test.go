package mobile

import (
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testSS = `proxies:
  - name: Test node
    type: ss
    server: 192.0.2.1
    port: 443
    cipher: aes-128-gcm
    password: test-secret
`

func TestSubscriptionFormats(t *testing.T) {
	uri := "ss://" + base64.RawURLEncoding.EncodeToString([]byte("aes-128-gcm:test-secret")) + "@192.0.2.1:443#Test%20node"
	for _, text := range []string{testSS, "# https://example.com/subscription\n" + testSS, uri, base64.StdEncoding.EncodeToString([]byte(uri)), `{"outbounds":[{"tag":"Test node","type":"shadowsocks","server":"192.0.2.1","server_port":443,"method":"aes-128-gcm","password":"test-secret"}]}`} {
		raw, e := ParseSubscription(text)
		if e != nil {
			t.Fatal(e)
		}
		summary, e := SubscriptionSummary(raw)
		if e != nil {
			t.Fatal(e)
		}
		if strings.Contains(summary, "test-secret") || strings.Contains(summary, "profile") || strings.Contains(summary, "192.0.2.1") {
			t.Fatal("secret leaked")
		}
		var b subscriptionBundle
		json.Unmarshal([]byte(raw), &b)
		if len(b.Nodes) != 1 || b.Nodes[0].Name != "Test node" {
			t.Fatal("wrong nodes")
		}
		p, e := SubscriptionProfile(raw, b.Revision, b.Nodes[0].ID)
		if e != nil || !strings.Contains(p, "test-secret") {
			t.Fatal("profile lookup failed")
		}
		if _, e = SubscriptionProfile(raw, strings.Repeat("0", 64), b.Nodes[0].ID); e == nil || e.Error() != "STALE_SUBSCRIPTION" {
			t.Fatal("stale accepted")
		}
	}
}
func TestSubscriptionRejectsUnsafeOrUnsupported(t *testing.T) {
	for _, text := range []string{
		"", "<html>login</html>", testSS + "---\n" + testSS,
		strings.Replace(testSS, "type: ss", "type: ss\n    type: trojan", 1),
		strings.Replace(testSS, "password: test-secret", "password: &p test-secret", 1),
		strings.Replace(testSS, "password: test-secret", "password: *missing", 1),
		strings.Replace(testSS, "type: ss", "type: ss\n    plugin: obfs", 1),
		strings.Replace(testSS, "type: ss", "type: ss\n    udp: false", 1),
		strings.Replace(testSS, "type: ss", "type: ss\n    skip-cert-verify: true", 1),
		strings.Replace(testSS, "type: ss", "type: ss\n    dialer-proxy: DIRECT", 1),
		`{"outbounds":[{"type":"trojan","server":"192.0.2.1","server_port":443,"password":"secret","tls":{"enabled":true,"insecure":true}}]}`,
		"ss://YWVzLTEyOC1nY206dGVzdA@192.0.2.1:443?plugin=obfs",
		"vless://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@192.0.2.1:443?security=reality",
		"trojan://test-secret@192.0.2.1:443?allowInsecure=1",
		"proxies: " + strings.Repeat("[", 25) + strings.Repeat("]", 25),
	} {
		if _, e := ParseSubscription(text); e == nil {
			t.Fatal("invalid input accepted")
		} else if strings.Contains(e.Error(), "test-secret") {
			t.Fatal("error leaked secret")
		}
	}
	if _, e := ParseSubscription(strings.Repeat("x", subscriptionLimit+1)); e == nil || e.Error() != "SUBSCRIPTION_TOO_LARGE" {
		t.Fatal("size")
	}
	if _, e := ParseSubscription("proxies:\n" + strings.Repeat("  - type: unsupported\n", 257)); e == nil || e.Error() != "SUBSCRIPTION_NODE_LIMIT" {
		t.Fatal("count")
	}
}
func TestSubscriptionSubsetAndDomain(t *testing.T) {
	text := strings.Replace(testSS, "192.0.2.1", "example.com", 1) + "  - {type: vmess, name: Unsupported}\nexternal-controller: 0.0.0.0:9090\nproxy-providers: {other: {url: 'https://invalid.example/'}}\n"
	raw, e := ParseSubscription(text)
	if e != nil {
		t.Fatal(e)
	}
	b, _ := readBundle(raw)
	if b.Skipped != 1 || b.Nodes[0].BlockedReason != "" {
		t.Fatal("subset")
	}
	b.Nodes[0].BlockedReason = "NUMERIC_ENDPOINT_REQUIRED"
	legacy, _ := json.Marshal(b)
	if _, e := SubscriptionProfile(string(legacy), b.Revision, b.Nodes[0].ID); e != nil {
		t.Fatal("old domain bundle not migrated", e)
	}
	summary, e := SubscriptionSummary(string(legacy))
	if e != nil || strings.Contains(summary, "NUMERIC_ENDPOINT_REQUIRED") {
		t.Fatal("old metadata not migrated")
	}

	// Only extracted nodes survive; remote controllers, providers and DNS are not applied.
	if strings.Contains(raw, "9090") || strings.Contains(raw, "invalid.example") {
		t.Fatal("remote config retained")
	}
	for _, uri := range []string{
		"trojan://test-secret@192.0.2.1:443?sni=example.com#Trojan",
		"vless://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@192.0.2.1:443?security=tls&type=tcp&sni=example.com#VLESS",
	} {
		if _, e := ParseSubscription(uri); e != nil {
			t.Fatal(e)
		}
	}
}
func TestSubscriptionDownload(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/valid":
			w.Write([]byte(testSS))
		case "/redirect":
			http.Redirect(w, r, "/valid", 302)
		case "/downgrade":
			http.Redirect(w, r, "http://127.0.0.1/secret", 302)
		case "/loop":
			http.Redirect(w, r, "/loop", 302)
		case "/large":
			w.Write([]byte(strings.Repeat("x", subscriptionLimit+1)))
		case "/gzip":
			w.Header().Set("Content-Encoding", "gzip")
			g := gzip.NewWriter(w)
			g.Write([]byte(strings.Repeat("x", subscriptionLimit+1)))
			g.Close()
		case "/slow":
			select {
			case <-r.Context().Done():
			case <-time.After(time.Second):
			}
		default:
			http.Error(w, "test-secret", 403)
		}
	}))
	defer server.Close()
	client := server.Client()
	for _, path := range []string{"/valid", "/redirect"} {
		if _, e := fetchSubscription(server.URL+path, client.Transport, time.Second); e != nil {
			t.Fatal(e)
		}
	}
	for _, item := range []struct{ path, code string }{{"/downgrade", "SUBSCRIPTION_DOWNLOAD_FAILED"}, {"/loop", "SUBSCRIPTION_DOWNLOAD_FAILED"}, {"/large", "SUBSCRIPTION_TOO_LARGE"}, {"/gzip", "SUBSCRIPTION_TOO_LARGE"}, {"/error", "SUBSCRIPTION_HTTP_ERROR"}, {"/slow", "SUBSCRIPTION_TIMEOUT"}} {
		timeout := 3 * time.Second
		if item.path == "/slow" {
			timeout = 100 * time.Millisecond
		}
		if _, e := fetchSubscription(server.URL+item.path, client.Transport, timeout); e == nil || e.Error() != item.code {
			t.Fatalf("%s: %v", item.path, e)
		}
	}
	// Production trust roots do not accept an untrusted fixture certificate.
	if _, e := FetchSubscription(server.URL + "/valid?token=test-secret"); e == nil || e.Error() != "SUBSCRIPTION_DOWNLOAD_FAILED" {
		t.Fatal("TLS trust bypass")
	}
}

// Synthetic examples only; never copy a subscriber URL, UUID or key into tests.
func TestURIExporterNeutralDefaults(t *testing.T) {
	base := "vless://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@proxy.test:443?security=tls&type=ws&path=%2Ftunnel&host=cdn.test&fp=ios&sni=proxy.test"
	expected, e := ParseSubscription(base)
	if e != nil {
		t.Fatal(e)
	}
	a, _ := readBundle(expected)
	for _, suffix := range []string{
		"&insecure=0&headerType=none&quicSecurity=none&serviceName=&pcs=",
		"&allowInsecure=false&headerType=&quicSecurity=&serviceName=",
	} {
		got, e := ParseSubscription(base + suffix)
		if e != nil {
			t.Fatal(e)
		}
		b, _ := readBundle(got)
		if string(a.Nodes[0].Profile) != string(b.Nodes[0].Profile) {
			t.Fatal("neutral options changed profile")
		}
	}
	for _, suffix := range []string{"&insecure=1", "&allowInsecure=true", "&insecure=0&insecure=1", "&headerType=http", "&quicSecurity=aes-128-gcm", "&pcs=nonempty-pin", "&serviceName=nonempty", "&unknown="} {
		if _, e := ParseSubscription(base + suffix); e == nil {
			t.Fatal("meaningful/unknown option silently discarded")
		}
	}
	reality := "vless://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@proxy.test:443?security=reality&type=tcp&sni=proxy.test&pbk=CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=abcd&flow=xtls-rprx-vision&fp=safari&host=&path=&serviceName=&insecure=0&pcs=&headerType=none&quicSecurity=none"
	if _, e := ParseSubscription(reality); e != nil {
		t.Fatal(e)
	}
}
