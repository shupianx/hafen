package mobile

import (
	"crypto/ecdh"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
	"unicode"
)

type profileReality struct {
	PublicKey string `json:"public_key"`
	ShortID   string `json:"short_id"`
}
type profileObfs struct {
	Type     string `json:"type"`
	Password string `json:"password"`
}
type profileTransport struct {
	Type                string            `json:"type"`
	Path                string            `json:"path,omitempty"`
	Headers             map[string]string `json:"headers,omitempty"`
	MaxEarlyData        uint32            `json:"max_early_data,omitempty"`
	EarlyDataHeaderName string            `json:"early_data_header_name,omitempty"`
	ServiceName         string            `json:"service_name,omitempty"`
}

func plainText(s string, limit int) bool {
	if len(s) > limit {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func validateOptions(p profile) bool {
	if p.Type == "hysteria2" {
		if p.Transport != nil || p.Reality != nil || p.Fingerprint != "" || p.Flow != "" || p.UpMbps < 0 || p.UpMbps > 10000 || p.DownMbps < 0 || p.DownMbps > 10000 {
			return false
		}
		if len(p.ALPN) > 0 && (len(p.ALPN) != 1 || p.ALPN[0] != "h3") {
			return false
		}
		if p.CertificateSHA256 != "" && !validCertificateHash(p.CertificateSHA256) {
			return false
		}
		if len(p.ServerPorts) > 16 {
			return false
		}
		for _, ports := range p.ServerPorts {
			if _, ok := normalizePortRange(ports, ":"); !ok {
				return false
			}
		}
		if p.HopInterval != "" {
			d, e := time.ParseDuration(p.HopInterval)
			if e != nil || len(p.ServerPorts) == 0 || d < 5*time.Second || d > time.Hour {
				return false
			}
		}
		return p.Obfs == nil || (p.Obfs.Type == "salamander" && p.Obfs.Password != "" && len(p.Obfs.Password) <= 4096)
	}
	if p.Obfs != nil || p.UpMbps != 0 || p.DownMbps != 0 || len(p.ServerPorts) != 0 || p.HopInterval != "" || p.CertificateSHA256 != "" {
		return false
	}
	if p.Type == "shadowsocks" {
		return p.Transport == nil && p.Reality == nil && p.Fingerprint == "" && len(p.ALPN) == 0 && p.Flow == ""
	}
	if p.Type == "anytls" && p.Transport != nil {
		return false
	}
	if p.Flow != "" && (p.Type != "vless" || p.Flow != "xtls-rprx-vision" || p.Transport != nil) {
		return false
	}
	if p.Fingerprint != "" && !containsWord("chrome firefox edge safari ios android random randomized", p.Fingerprint) {
		return false
	}
	if len(p.ALPN) > 4 {
		return false
	}
	for _, v := range p.ALPN {
		if v == "" || !plainText(v, 32) {
			return false
		}
	}
	if r := p.Reality; r != nil {
		if p.Type != "vless" || p.Transport != nil || p.ServerName == "" {
			return false
		}
		key, e := base64.RawURLEncoding.Strict().DecodeString(r.PublicKey)
		if e != nil || len(key) != 32 {
			return false
		}
		pub, e := ecdh.X25519().NewPublicKey(key)
		if e != nil {
			return false
		}
		// Reject low-order/all-zero public keys before handing them to the engine.
		private, _ := ecdh.X25519().NewPrivateKey([]byte{1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0})
		if _, e = private.ECDH(pub); e != nil {
			return false
		}
		if len(r.ShortID) > 16 {
			return false
		}
		if _, e := hex.DecodeString(r.ShortID); e != nil {
			return false
		}
	}
	if tr := p.Transport; tr != nil {
		if tr.Type == "ws" {
			if tr.ServiceName != "" || tr.MaxEarlyData > 65535 || !plainText(tr.Path, 2048) || (tr.Path != "" && !strings.HasPrefix(tr.Path, "/")) {
				return false
			}
			if tr.EarlyDataHeaderName != "" && (tr.MaxEarlyData == 0 || !headerToken(tr.EarlyDataHeaderName)) {
				return false
			}
			if len(tr.Headers) > 8 {
				return false
			}
			seen := map[string]bool{}
			for k, v := range tr.Headers {
				lower := strings.ToLower(k)
				if !headerToken(k) || len(k) > 64 || !plainText(v, 1024) || seen[lower] || strings.HasPrefix(lower, "sec-websocket-") || containsWord("connection upgrade content-length transfer-encoding", lower) {
					return false
				}
				seen[lower] = true
			}
			if len(p.ALPN) > 0 && (len(p.ALPN) != 1 || p.ALPN[0] != "http/1.1") {
				return false
			}
		} else if tr.Type == "grpc" {
			if tr.Path != "" || len(tr.Headers) != 0 || tr.MaxEarlyData != 0 || tr.EarlyDataHeaderName != "" || !plainText(tr.ServiceName, 256) || strings.ContainsAny(tr.ServiceName, "?#\\") {
				return false
			}
			if len(p.ALPN) > 0 && (len(p.ALPN) != 1 || p.ALPN[0] != "h2") {
				return false
			}
		} else {
			return false
		}
	}
	return true
}
func headerToken(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", r)) {
			return false
		}
	}
	return true
}
func containsWord(words, value string) bool {
	for _, word := range strings.Fields(words) {
		if word == value {
			return true
		}
	}
	return false
}
func applyOptions(p profile, proxy map[string]any) {
	if p.Type == "shadowsocks" {
		return
	}
	tls := proxy["tls"].(map[string]any)
	if len(p.ALPN) > 0 {
		tls["alpn"] = p.ALPN
	}
	if p.Type == "hysteria2" {
		if p.CertificateSHA256 != "" {
			proxy["certificate_sha256"] = p.CertificateSHA256
		}
		if len(p.ServerPorts) > 0 {
			ports := make([]string, len(p.ServerPorts))
			for i, value := range p.ServerPorts {
				ports[i], _ = normalizePortRange(value, ":")
			}
			proxy["server_ports"] = ports
		}
		if p.HopInterval != "" {
			proxy["hop_interval"] = p.HopInterval
		}
		if p.Obfs != nil {
			proxy["obfs"] = p.Obfs
		}
		if p.UpMbps > 0 {
			proxy["up_mbps"] = p.UpMbps
		}
		if p.DownMbps > 0 {
			proxy["down_mbps"] = p.DownMbps
		}
		return
	}
	fingerprint := p.Fingerprint
	if p.Reality != nil {
		if fingerprint == "" {
			fingerprint = "chrome"
		}
		tls["reality"] = map[string]any{"enabled": true, "public_key": p.Reality.PublicKey, "short_id": p.Reality.ShortID}
	}
	if fingerprint != "" {
		tls["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
	}
	if p.Flow != "" {
		proxy["flow"] = p.Flow
	}
	if tr := p.Transport; tr != nil {
		transport := map[string]any{"type": tr.Type}
		if tr.Type == "ws" {
			transport["path"] = tr.Path
			headers := http.Header{}
			for k, v := range tr.Headers {
				headers.Set(k, v)
			}
			transport["headers"] = headers
			transport["max_early_data"] = tr.MaxEarlyData
			transport["early_data_header_name"] = tr.EarlyDataHeaderName
		} else {
			transport["service_name"] = tr.ServiceName
		}
		proxy["transport"] = transport
	}
}
