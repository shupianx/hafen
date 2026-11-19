package host

import (
	"encoding/json"
	"strings"
	"testing"
)

// Run with hafen_host: the host must still construct real upstream outbounds
// and exercise the original local encrypted relay without linking the TUN.
func TestHostServices(t *testing.T) {
	profiles := []string{
		`{"type":"shadowsocks","server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"fixture-only"}`,
		`{"type":"trojan","server":"proxy.example","server_port":443,"password":"fixture-only"}`,
		`{"type":"vless","server":"proxy.example","server_port":443,"uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","flow":"xtls-rprx-vision","fingerprint":"chrome"}`,
		`{"type":"hysteria2","server":"proxy.example","server_port":443,"password":"fixture-only","obfs":{"type":"salamander","password":"fixture-only"}}`,
	}
	for _, profile := range profiles {
		if err := CheckProfile(profile); err != nil {
			t.Fatal("host rejected supported profile", err)
		}
	}
	if err := CheckProfile(`{"type":"vless","server":"https://invalid.example"}`); err == nil {
		t.Fatal("invalid profile accepted")
	}
	content := `{"outbounds":[
 {"type":"shadowsocks","tag":"SS","server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"fixture-only"},
 {"type":"trojan","tag":"Trojan","server":"proxy.example","server_port":443,"password":"fixture-only","tls":{"enabled":true}},
 {"type":"vless","tag":"VLESS","server":"proxy.example","server_port":443,"uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","flow":"xtls-rprx-vision","tls":{"enabled":true,"utls":{"enabled":true,"fingerprint":"chrome"}}},
 {"type":"hysteria2","tag":"HY2","server":"proxy.example","server_port":443,"password":"fixture-only","tls":{"enabled":true},"obfs":{"type":"salamander","password":"fixture-only"}}
]}`
	bundle, err := ParseSubscription(content)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := SubscriptionSummary(bundle)
	if err != nil || strings.Contains(summary, "fixture-only") {
		t.Fatal("summary leaked credentials or failed", err)
	}
	var result struct {
		Revision string `json:"revision"`
		Nodes    []struct {
			ID string `json:"id"`
		} `json:"nodes"`
	}
	if json.Unmarshal([]byte(summary), &result) != nil || len(result.Nodes) != len(profiles) {
		t.Fatal("host lost supported nodes")
	}
	for _, node := range result.Nodes {
		profile, err := SubscriptionProfile(bundle, result.Revision, node.ID)
		if err != nil || CheckProfile(profile) != nil {
			t.Fatal("stored profile cannot be selected", err)
		}
	}
	if _, err := SubscriptionProfile(bundle, "stale", result.Nodes[0].ID); err == nil {
		t.Fatal("stale subscription accepted")
	}
	resultJSON, err := SelfTest()
	if err != nil || !strings.Contains(resultJSON, `"ok":true`) {
		t.Fatal("host encrypted relay failed", err)
	}
}
