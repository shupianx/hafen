package mobile

import (
	"encoding/hex"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func validCertificateHash(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32
}
func normalizeCertificateHash(s string) (string, bool) {
	// Accept compact hex or conventional colon-separated octets only.
	if strings.Contains(s, ":") {
		parts := strings.Split(s, ":")
		if len(parts) != 32 {
			return "", false
		}
		for _, p := range parts {
			if len(p) != 2 {
				return "", false
			}
		}
		s = strings.Join(parts, "")
	}
	return strings.ToLower(s), validCertificateHash(s)
}
func normalizePortRange(s, separator string) (string, bool) {
	parts := strings.Split(s, separator)
	if len(parts) > 2 || len(parts) == 0 {
		return "", false
	}
	values := []int{}
	for _, p := range parts {
		if p == "" {
			return "", false
		}
		for _, r := range p {
			if r < '0' || r > '9' {
				return "", false
			}
		}
		n, e := strconv.Atoi(p)
		if e != nil || n < 1 || n > 65535 {
			return "", false
		}
		values = append(values, n)
	}
	if len(values) == 1 {
		return strconv.Itoa(values[0]) + ":" + strconv.Itoa(values[0]), true
	}
	if values[0] > values[1] {
		return "", false
	}
	return strconv.Itoa(values[0]) + ":" + strconv.Itoa(values[1]), true
}
func mapPortRanges(value any, clash bool) ([]string, bool) {
	var parts []string
	if clash {
		s, ok := value.(string)
		if !ok || s == "" {
			return nil, false
		}
		parts = strings.Split(s, ",")
	} else if !decodeStrings(value, &parts) {
		return nil, false
	}
	if len(parts) == 0 || len(parts) > 16 {
		return nil, false
	}
	result := []string{}
	for _, s := range parts {
		separator := ":"
		if clash {
			separator = "-"
		}
		n, ok := normalizePortRange(strings.TrimSpace(s), separator)
		if !ok {
			return nil, false
		}
		result = append(result, n)
	}
	return result, true
}
func bandwidthMbps(v any) (int, bool) {
	// Clash's unqualified bandwidth and Mbps suffix use decimal megabits/sec.
	if n, ok := v.(int); ok {
		return n, n >= 0 && n <= 10000
	}
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	s = strings.TrimSpace(s)
	s = strings.TrimSpace(strings.TrimSuffix(s, "Mbps"))
	if s == "" {
		return 0, false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	n, e := strconv.Atoi(s)
	return n, e == nil && n >= 0 && n <= 10000
}

func mapHysteria2Node(m map[string]any, format string) (profile, string, bool) {
	p := profile{Type: "hysteria2"}
	nameKey, portKey := "name", "port"
	clash := format == "clash"
	keys := "name type server port password sni skip-cert-verify alpn udp up down obfs obfs-password ports hop-interval fingerprint"
	if !clash {
		nameKey, portKey = "tag", "server_port"
		keys = "tag type server server_port password tls up_mbps down_mbps obfs server_ports hop_interval"
	}
	name := stringField(m, nameKey)
	if !allowed(m, keys) {
		return p, name, false
	}
	if _, ok := m[nameKey]; ok && name == "" {
		return p, name, false
	}
	for _, key := range []string{"server", "password", "sni", "obfs-password", "fingerprint"} {
		if v, ok := m[key]; ok {
			if _, ok := v.(string); !ok {
				return p, name, false
			}
		}
	}
	p.Server, p.Password = stringField(m, "server"), stringField(m, "password")
	if n, ok := m[portKey].(int); ok && n > 0 && n <= 65535 {
		p.ServerPort = uint16(n)
	}
	if clash {
		p.ServerName = stringField(m, "sni")
		if v, ok := m["skip-cert-verify"]; ok && v != false {
			return p, name, false
		}
		if v, ok := m["udp"]; ok && v != true {
			return p, name, false
		}
		if v, ok := m["alpn"]; ok && !decodeStrings(v, &p.ALPN) {
			return p, name, false
		}
		if v, ok := m["fingerprint"]; ok {
			var good bool
			p.CertificateSHA256, good = normalizeCertificateHash(v.(string))
			if !good {
				return p, name, false
			}
		}
		if v, ok := m["obfs"]; ok {
			kind, ok := v.(string)
			if !ok {
				return p, name, false
			}
			if kind != "" {
				p.Obfs = &profileObfs{Type: kind, Password: stringField(m, "obfs-password")}
			}
		}
		if p.Obfs == nil && stringField(m, "obfs-password") != "" {
			return p, name, false
		}
	} else {
		tls, ok := m["tls"].(map[string]any)
		if !ok || !allowed(tls, "enabled server_name insecure alpn") || tls["enabled"] != true {
			return p, name, false
		}
		if v, ok := tls["insecure"]; ok && v != false {
			return p, name, false
		}
		if v, ok := tls["server_name"]; ok {
			var good bool
			p.ServerName, good = v.(string)
			if !good {
				return p, name, false
			}
		}
		if v, ok := tls["alpn"]; ok && !decodeStrings(v, &p.ALPN) {
			return p, name, false
		}
		if v, ok := m["obfs"]; ok {
			opts, ok := v.(map[string]any)
			if !ok || !allowed(opts, "type password") {
				return p, name, false
			}
			p.Obfs = &profileObfs{}
			if !decodeOption(opts, p.Obfs) {
				return p, name, false
			}
		}
	}
	up, down, ports, hop := "up", "down", "ports", "hop-interval"
	if !clash {
		up, down, ports, hop = "up_mbps", "down_mbps", "server_ports", "hop_interval"
	}
	for _, field := range []struct {
		key    string
		target *int
	}{{up, &p.UpMbps}, {down, &p.DownMbps}} {
		if v, ok := m[field.key]; ok {
			if !clash {
				if _, ok := v.(int); !ok {
					return p, name, false
				}
			}
			n, ok := bandwidthMbps(v)
			if !ok {
				return p, name, false
			}
			*field.target = n
		}
	}
	if v, ok := m[ports]; ok {
		var good bool
		p.ServerPorts, good = mapPortRanges(v, clash)
		if !good {
			return p, name, false
		}
	}
	if v, ok := m[hop]; ok {
		if clash {
			n, ok := v.(int)
			if !ok || n < 5 || n > 3600 {
				return p, name, false
			}
			p.HopInterval = (time.Duration(n) * time.Second).String()
		} else {
			s, ok := v.(string)
			if !ok {
				return p, name, false
			}
			d, e := time.ParseDuration(s)
			if e != nil {
				return p, name, false
			}
			p.HopInterval = d.String()
		}
	}
	// sing-box and Clash use server_ports/ports in preference to server_port/port.
	if len(p.ServerPorts) > 0 {
		if _, present := m[portKey]; !present {
			n, _ := strconv.Atoi(strings.Split(p.ServerPorts[0], ":")[0])
			p.ServerPort = uint16(n)
		}
	}
	return p, name, true
}

func parseHysteria2URI(u *url.URL, q url.Values, m map[string]any) map[string]any {
	m["type"] = "hysteria2"
	password := u.User.Username()
	if pass, ok := u.User.Password(); ok {
		password += ":" + pass
	}
	m["password"] = password
	for key, values := range q {
		if len(values) != 1 {
			return nil
		}
		v := values[0]
		switch key {
		case "insecure", "allowInsecure":
			if v != "" && v != "0" && v != "false" {
				return nil
			}
		case "sni":
			if v != "" {
				m["sni"] = v
			}
		case "alpn":
			if v != "" {
				m["alpn"] = strings.Split(v, ",")
			}
		case "obfs", "obfs-password":
			if v != "" {
				m[key] = v
			}
		case "pinSHA256":
			if v != "" {
				m["fingerprint"] = v
			}
		case "mport":
			if v != "" {
				m["ports"] = v
			}
		case "upmbps", "downmbps":
			n, ok := bandwidthMbps(v)
			if !ok {
				return nil
			}
			if key == "upmbps" {
				m["up"] = n
			} else {
				m["down"] = n
			}
		default:
			return nil
		}
	}
	return m
}
