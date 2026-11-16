package mobile

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLinkedVersion(t *testing.T) {
	var info struct {
		Version         string
		Ready           bool
		TunnelAvailable bool
	}
	if err := json.Unmarshal([]byte(Info()), &info); err != nil {
		t.Fatal(err)
	}
	// Go test binaries may omit dependency versions. Verify lock in build script.
	if info.Version != "unknown" && info.Version != pinnedVersion {
		t.Fatal(Info())
	}
	if info.TunnelAvailable {
		t.Fatal("a linked core is not a VPN")
	}
}

func TestProfilesUseActualCoreValidation(t *testing.T) {
	for _, value := range []string{
		`{"type":"shadowsocks","server":"example.com","server_port":443,"method":"aes-128-gcm","password":"test-only"}`,
		`{"type":"trojan","server":"example.com","server_port":443,"password":"test-only","server_name":"example.com"}`,
		`{"type":"vless","server":"example.com","server_port":443,"uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}`,
	} {
		if err := CheckProfile(value); err != nil {
			t.Fatal(err)
		}
	}
}

func TestUnsafeOrUnsupportedProfilesFailWithoutSecrets(t *testing.T) {
	for _, value := range []string{
		`{}`, `null`, `{} {}`, strings.Repeat("x", 16385),
		`{"type":"trojan","server":"example.com","server_port":443,"password":"SECRET","insecure":true}`,
		`{"type":"trojan","server":"example.com","server_port":443,"password":"SECRET","certificate_path":"/private/key"}`,
		`{"type":"trojan","server":"example.com","server_port":70000,"password":"SECRET"}`,
		`{"type":"trojan","server":"https://example.com","server_port":443,"password":"SECRET"}`,
		`{"type":"shadowsocks","server":"example.com","server_port":443,"method":"none","password":"SECRET"}`,
		`{"type":"vless","server":"example.com","server_port":443,"uuid":"SECRET"}`,
		`{"type":"hysteria2","server":"example.com","server_port":443,"password":"SECRET","fingerprint":"chrome"}`,
	} {
		err := CheckProfile(value)
		if err == nil {
			t.Fatal("accepted unsupported profile")
		}
		if strings.Contains(err.Error(), "SECRET") {
			t.Fatal("credential in error")
		}
	}
}

func TestTLSCannotBeDisabled(t *testing.T) {
	p, err := parseProfile(`{"type":"trojan","server":"example.com","server_port":443,"password":"test-only"}`)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Outbounds []struct {
			TLS struct {
				Enabled    bool
				Insecure   bool
				ServerName string `json:"server_name"`
			}
		}
	}
	if err = json.Unmarshal(profileConfig(p), &config); err != nil {
		t.Fatal(err)
	}
	tls := config.Outbounds[0].TLS
	if !tls.Enabled || tls.Insecure || tls.ServerName != "example.com" {
		t.Fatal("TLS policy lost")
	}
}

func TestEncryptedLoopbackAndCleanup(t *testing.T) {
	for i := 0; i < 3; i++ {
		if err := selfTest(); err != nil {
			t.Fatal(err)
		}
	}
}
