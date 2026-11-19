// Package mobile is Hafen's small binding to the upstream sing-box engine.
// It implements application policy and lifecycle, never proxy protocols.
package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"runtime/debug"
	"strings"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/adapter/certificate"
	"github.com/sagernet/sing-box/adapter/endpoint"
	"github.com/sagernet/sing-box/adapter/inbound"
	"github.com/sagernet/sing-box/adapter/outbound"
	boxservice "github.com/sagernet/sing-box/adapter/service"
	"github.com/sagernet/sing-box/dns"
	"github.com/sagernet/sing-box/dns/transport"
	"github.com/sagernet/sing-box/dns/transport/hosts"
	"github.com/sagernet/sing-box/dns/transport/local"
	"github.com/sagernet/sing-box/option"
	"github.com/sagernet/sing-box/protocol/direct"
	"github.com/sagernet/sing-box/protocol/shadowsocks"
	"github.com/sagernet/sing-box/protocol/trojan"
	"github.com/sagernet/sing-box/protocol/vless"
	boxjson "github.com/sagernet/sing/common/json"
	"github.com/sagernet/sing/service"
)

const pinnedVersion = "1.14.4"

var errProfile = errors.New("INVALID_CORE_PROFILE")

// Info reports the linked dependency, not an optimistic UI capability flag.
func Info() string {
	version := "unknown"
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			if dep.Path == "github.com/sagernet/sing-box" && dep.Replace == nil {
				version = strings.TrimPrefix(dep.Version, "v")
			}
		}
	}
	value, _ := json.Marshal(map[string]any{
		"name": "sing-box", "version": version, "bindingVersion": 1,
		"ready": version == pinnedVersion, "tunnelAvailable": false,
		"protocols": []string{"shadowsocks", "trojan", "vless", "hysteria2"},
	})
	return string(value)
}

// profile is intentionally narrower than arbitrary sing-box JSON. Remote input
// cannot create listeners, controllers, file paths, scripts, or DNS servers.
type profile struct {
	Type              string            `json:"type"`
	Server            string            `json:"server"`
	ServerPort        uint16            `json:"server_port"`
	Password          string            `json:"password,omitempty"`
	Method            string            `json:"method,omitempty"`
	UUID              string            `json:"uuid,omitempty"`
	ServerName        string            `json:"server_name,omitempty"`
	Fingerprint       string            `json:"fingerprint,omitempty"`
	ALPN              []string          `json:"alpn,omitempty"`
	Reality           *profileReality   `json:"reality,omitempty"`
	Flow              string            `json:"flow,omitempty"`
	Transport         *profileTransport `json:"transport,omitempty"`
	Obfs              *profileObfs      `json:"obfs,omitempty"`
	UpMbps            int               `json:"up_mbps,omitempty"`
	DownMbps          int               `json:"down_mbps,omitempty"`
	ServerPorts       []string          `json:"server_ports,omitempty"`
	HopInterval       string            `json:"hop_interval,omitempty"`
	CertificateSHA256 string            `json:"certificate_sha256,omitempty"`
}

func parseProfile(content string) (profile, error) {
	var p profile
	if len(content) == 0 || len(content) > 16*1024 {
		return p, errProfile
	}
	decoder := json.NewDecoder(strings.NewReader(content))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&p) != nil {
		return p, errProfile
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return p, errProfile
	}
	if !validHost(p.Server) || p.ServerPort == 0 || len(p.Password) > 4096 {
		return p, errProfile
	}
	if p.ServerName != "" && !validHost(p.ServerName) {
		return p, errProfile
	}
	switch p.Type {
	case "shadowsocks":
		if p.Password == "" || p.UUID != "" || p.ServerName != "" {
			return p, errProfile
		}
		switch p.Method {
		case "aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305":
		default:
			return p, errProfile
		}
	case "trojan", "hysteria2":
		if p.Password == "" || p.Method != "" || p.UUID != "" {
			return p, errProfile
		}
	case "vless":
		if !validUUID(p.UUID) || p.Password != "" || p.Method != "" {
			return p, errProfile
		}
	default:
		return p, errors.New("UNSUPPORTED_CORE_PROTOCOL")
	}
	if !validateOptions(p) {
		return p, errProfile
	}
	return p, nil
}

func validHost(host string) bool {
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Zone() == ""
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

func profileConfig(p profile) []byte {
	proxy := map[string]any{"type": p.Type, "tag": "proxy", "server": p.Server, "server_port": p.ServerPort}
	if p.Type == "shadowsocks" {
		proxy["method"], proxy["password"] = p.Method, p.Password
	} else {
		serverName := p.ServerName
		if serverName == "" {
			serverName = p.Server
		}
		proxy["tls"] = map[string]any{"enabled": true, "server_name": serverName, "insecure": false}
		if p.Type == "trojan" || p.Type == "hysteria2" {
			proxy["password"] = p.Password
		} else {
			proxy["uuid"] = p.UUID
		}
	}
	applyOptions(p, proxy)
	// No listener or system route is installed by profile checking.
	content, _ := json.Marshal(map[string]any{
		"log":       map[string]any{"disabled": true},
		"dns":       map[string]any{"servers": []any{map[string]any{"type": "local", "tag": "bootstrap"}}},
		"outbounds": []any{proxy},
		"route":     map[string]any{"final": "proxy", "default_domain_resolver": "bootstrap"},
	})
	return content
}

func coreContext() context.Context {
	i, o, d := inbound.NewRegistry(), outbound.NewRegistry(), dns.NewTransportRegistry()
	shadowsocks.RegisterInbound(i) // Used only by the bounded localhost diagnostic.
	registerPacketInbound(i)
	direct.RegisterOutbound(o)
	shadowsocks.RegisterOutbound(o)
	trojan.RegisterOutbound(o)
	vless.RegisterOutbound(o)
	registerHysteria2(o)
	local.RegisterTransport(d)
	hosts.RegisterTransport(d)
	transport.RegisterUDP(d)
	transport.RegisterTCP(d)
	transport.RegisterTLS(d)
	transport.RegisterHTTPS(d)
	return box.Context(context.Background(), i, o, endpoint.NewRegistry(), d, boxservice.NewRegistry(), certificate.NewRegistry())
}

func newInstance(content []byte) (*box.Box, context.CancelFunc, error) {
	ctx, cancel := context.WithCancel(coreContext())
	ctx = service.ContextWith[adapter.PlatformInterface](ctx, &diagnosticPlatform{})
	options, err := boxjson.UnmarshalExtendedContext[option.Options](ctx, content)
	if err != nil {
		cancel()
		return nil, nil, errProfile
	}
	instance, err := box.New(box.Options{Options: options, Context: ctx})
	if err != nil {
		cancel()
		return nil, nil, errors.New("CORE_CONFIGURATION_FAILED")
	}
	return instance, cancel, nil
}

// CheckProfile performs actual upstream option/outbound construction, without
// opening a VPN, fetching remote resources, or returning credentials.
func CheckProfile(content string) error {
	p, err := parseProfile(content)
	if err != nil {
		return err
	}
	instance, cancel, err := newInstance(profileConfig(p))
	if err != nil {
		return err
	}
	defer cancel()
	if instance.Close() != nil {
		return errors.New("CORE_CLOSE_FAILED")
	}
	return nil
}
