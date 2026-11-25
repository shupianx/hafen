package mobile

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"
)

const subscriptionLimit = 512 * 1024
const nodeLimit = 256

var errSubscription = errors.New("INVALID_SUBSCRIPTION_CONTENT")

type subscriptionNode struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Type          string          `json:"type"`
	BlockedReason string          `json:"blockedReason"`
	Profile       json.RawMessage `json:"profile,omitempty"`
}
type subscriptionBundle struct {
	Revision    string             `json:"revision"`
	UpdatedAtMs int64              `json:"updatedAtMs"`
	Format      string             `json:"format"`
	Skipped     int                `json:"skipped"`
	Nodes       []subscriptionNode `json:"nodes"`
}

// FetchSubscription never returns raw HTTP/TLS errors (which can contain tokens).
// Only native storage receives this result; UI must use SubscriptionSummary.
func FetchSubscription(sourceURL string) (string, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.MaxResponseHeaderBytes = 32 * 1024
	defer transport.CloseIdleConnections()
	return fetchSubscription(sourceURL, transport, 20*time.Second)
}
func subscriptionURL(raw string) bool {
	if len(raw) == 0 || len(raw) > 8192 || strings.ContainsAny(raw, "\\# \r\n\t") {
		return false
	}
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return false
	}
	if p := u.Port(); p != "" {
		n, e := strconv.Atoi(p)
		if e != nil || n < 1 || n > 65535 {
			return false
		}
	}
	return true
}
func fetchSubscription(sourceURL string, transport http.RoundTripper, timeout time.Duration) (string, error) {
	if !subscriptionURL(sourceURL) {
		return "", errors.New("INVALID_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	client := &http.Client{Transport: transport, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) > 3 || !subscriptionURL(r.URL.String()) {
			return errors.New("SUBSCRIPTION_REDIRECT_REJECTED")
		}
		return nil
	}}
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if e != nil {
		return "", errors.New("INVALID_URL")
	}
	req.Header.Set("User-Agent", "Hafen/0.1")
	req.Header.Set("Accept", "text/plain, application/yaml, application/json")
	response, e := client.Do(req)
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			return "", errors.New("SUBSCRIPTION_TIMEOUT")
		}
		return "", errors.New("SUBSCRIPTION_DOWNLOAD_FAILED")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", errors.New("SUBSCRIPTION_HTTP_ERROR")
	}
	if response.ContentLength > subscriptionLimit {
		return "", errors.New("SUBSCRIPTION_TOO_LARGE")
	}
	data, e := io.ReadAll(io.LimitReader(response.Body, subscriptionLimit+1))
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			return "", errors.New("SUBSCRIPTION_TIMEOUT")
		}
		return "", errors.New("SUBSCRIPTION_DOWNLOAD_FAILED")
	}
	if len(data) > subscriptionLimit {
		return "", errors.New("SUBSCRIPTION_TOO_LARGE")
	}
	return ParseSubscription(string(data))
}

// ParseSubscription extracts a narrow node subset, never a runnable remote config.
func ParseSubscription(content string) (string, error) {
	if len(content) > subscriptionLimit {
		return "", errors.New("SUBSCRIPTION_TOO_LARGE")
	}
	if !utf8.ValidString(content) {
		return "", errSubscription
	}
	text := strings.TrimSpace(strings.TrimPrefix(content, "\ufeff"))
	if text == "" {
		return "", errSubscription
	}
	if decoded, e := decodeBase64(strings.Join(strings.Fields(text), "")); e == nil && strings.Contains(decoded, "://") {
		text = decoded
	}
	sum := sha256.Sum256([]byte(content))
	bundle := subscriptionBundle{Revision: hex.EncodeToString(sum[:]), UpdatedAtMs: time.Now().UnixMilli(), Nodes: []subscriptionNode{}}
	var entries []map[string]any
	firstLine := strings.SplitN(text, "\n", 2)[0]
	firstURL, urlError := url.Parse(firstLine)
	isURIList := urlError == nil && firstURL.Scheme != "" && strings.HasPrefix(firstLine, firstURL.Scheme+"://")
	if isURIList {
		bundle.Format = "uri"
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if len(entries) >= nodeLimit {
				return "", errors.New("SUBSCRIPTION_NODE_LIMIT")
			}
			m := parseNodeURI(line)
			entries = append(entries, m)
		}
	} else {
		// Parse to an AST before conversion; reject aliases, duplicate keys, deep
		// nesting, complex keys and multiple documents. No YAML object constructors.
		d := yaml.NewDecoder(strings.NewReader(text))
		var doc yaml.Node
		if d.Decode(&doc) != nil {
			return "", errSubscription
		}
		count := 0
		if !safeYAML(&doc, 0, &count) {
			return "", errSubscription
		}
		var extra yaml.Node
		if d.Decode(&extra) != io.EOF {
			return "", errSubscription
		}
		var root map[string]any
		if doc.Decode(&root) != nil {
			return "", errSubscription
		}
		key := "proxies"
		bundle.Format = "clash"
		if _, yes := root["outbounds"]; yes {
			key = "outbounds"
			bundle.Format = "sing-box"
			if _, both := root["proxies"]; both {
				return "", errSubscription
			}
		}
		list, ok := root[key].([]any)
		if !ok {
			return "", errSubscription
		}
		if len(list) > nodeLimit {
			return "", errors.New("SUBSCRIPTION_NODE_LIMIT")
		}
		for _, value := range list {
			m, _ := value.(map[string]any)
			entries = append(entries, m)
		}
	}
	seen := map[string]bool{}
	for i, m := range entries {
		p, name, ok := mapNode(m, bundle.Format)
		if !ok {
			bundle.Skipped++
			continue
		}
		raw, _ := json.Marshal(p)
		if _, e := parseProfile(string(raw)); e != nil {
			bundle.Skipped++
			continue
		}
		if CheckProfile(string(raw)) != nil {
			bundle.Skipped++
			continue
		}
		h := sha256.Sum256(raw)
		id := hex.EncodeToString(h[:16])
		if seen[id] {
			bundle.Skipped++
			continue
		}
		if name == "" {
			name = fmt.Sprintf("Node %d", i+1)
		}
		if !safeName(name) {
			bundle.Skipped++
			continue
		}
		seen[id] = true
		bundle.Nodes = append(bundle.Nodes, subscriptionNode{ID: id, Name: name, Type: p.Type, Profile: raw})
	}
	if len(bundle.Nodes) == 0 {
		return "", errors.New("NO_SUPPORTED_NODES")
	}
	data, _ := json.Marshal(bundle)
	if len(data) > subscriptionLimit {
		return "", errors.New("SUBSCRIPTION_TOO_LARGE")
	}
	return string(data), nil
}
func safeName(s string) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > 128 {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return false
		}
	}
	return true
}
func safeYAML(n *yaml.Node, depth int, count *int) bool {
	*count++
	if depth > 16 || *count > 20000 || n.Kind == yaml.AliasNode || n.Anchor != "" {
		return false
	}
	if n.Kind == yaml.MappingNode {
		seen := map[string]bool{}
		for i := 0; i < len(n.Content); i += 2 {
			k := n.Content[i]
			if k.Kind != yaml.ScalarNode || k.Tag != "!!str" || seen[k.Value] || k.Value == "<<" {
				return false
			}
			seen[k.Value] = true
		}
	}
	for _, c := range n.Content {
		if !safeYAML(c, depth+1, count) {
			return false
		}
	}
	return true
}
func decodeBase64(s string) (string, error) {
	for _, encoding := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		b, e := encoding.Strict().DecodeString(s)
		if e == nil && utf8.Valid(b) {
			return string(b), nil
		}
	}
	return "", errSubscription
}
func stringField(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func allowed(m map[string]any, keys string) bool {
	for key := range m {
		if !strings.Contains(" "+keys+" ", " "+key+" ") {
			return false
		}
	}
	return true
}
func mapNode(m map[string]any, format string) (profile, string, bool) {
	p := profile{}
	if m == nil {
		return p, "", false
	}
	if format == "uri" {
		format = "clash"
	}
	if stringField(m, "type") == "hysteria2" {
		return mapHysteria2Node(m, format)
	}
	nameKey, portKey := "name", "port"
	keys := "name type server port password cipher uuid sni servername tls network udp skip-cert-verify client-fingerprint alpn reality-opts flow ws-opts grpc-opts"
	if format == "sing-box" {
		nameKey, portKey = "tag", "server_port"
		keys = "tag type server server_port password method uuid tls flow transport"
	}
	if stringField(m, "type") == "anytls" {
		keys = "name type server port password sni tls udp skip-cert-verify client-fingerprint alpn"
		if format == "sing-box" {
			keys = "tag type server server_port password tls"
		}
	}
	if !allowed(m, keys) {
		return p, "", false
	}
	p.Type = stringField(m, "type")
	if p.Type == "ss" && format == "clash" {
		p.Type = "shadowsocks"
	}
	p.Server = stringField(m, "server")
	if port, ok := m[portKey].(int); ok && port > 0 && port <= 65535 {
		p.ServerPort = uint16(port)
	}
	p.Password = stringField(m, "password")
	p.UUID = stringField(m, "uuid")
	p.Flow = stringField(m, "flow")
	name := stringField(m, nameKey)
	if _, exists := m[nameKey]; exists && name == "" {
		return p, "", false
	}
	for _, key := range []string{"server", "password", "uuid", "cipher", "method", "sni", "servername", "flow", "client-fingerprint", "network"} {
		if v, ok := m[key]; ok {
			if _, ok := v.(string); !ok {
				return p, name, false
			}
		}
	}
	if format == "clash" {
		p.Method = stringField(m, "cipher")
		p.Fingerprint = stringField(m, "client-fingerprint")
		for _, key := range []string{"udp", "skip-cert-verify", "tls"} {
			if v, exists := m[key]; exists {
				b, ok := v.(bool)
				if !ok || (key == "skip-cert-verify" && b) || (key == "udp" && !b) {
					return p, name, false
				}
			}
		}
		p.ServerName = stringField(m, "sni")
		if v := stringField(m, "servername"); v != "" {
			if p.ServerName != "" && p.ServerName != v {
				return p, name, false
			}
			p.ServerName = v
		}
		if p.Type == "vless" && m["tls"] != true {
			return p, name, false
		}
		if p.Type != "shadowsocks" {
			if v, exists := m["tls"]; exists && v != true {
				return p, name, false
			}
		} else {
			if _, exists := m["tls"]; exists {
				return p, name, false
			}
		}
		if v, exists := m["alpn"]; exists {
			if !decodeStrings(v, &p.ALPN) {
				return p, name, false
			}
		}
		if v, exists := m["reality-opts"]; exists {
			r, ok := v.(map[string]any)
			if !ok || !allowed(r, "public-key short-id") {
				return p, name, false
			}
			key, ok := r["public-key"].(string)
			if !ok {
				return p, name, false
			}
			sid := ""
			if v, ok := r["short-id"]; ok {
				var good bool
				sid, good = v.(string)
				if !good {
					return p, name, false
				}
			}
			p.Reality = &profileReality{PublicKey: key, ShortID: sid}
		}
		network := stringField(m, "network")
		switch network {
		case "", "tcp":
			if _, exists := m["ws-opts"]; exists {
				return p, name, false
			}
			if _, exists := m["grpc-opts"]; exists {
				return p, name, false
			}
		case "ws":
			if _, exists := m["grpc-opts"]; exists {
				return p, name, false
			}
			tr := &profileTransport{Type: "ws"}
			if v, exists := m["ws-opts"]; exists {
				opts, ok := v.(map[string]any)
				if !ok || !allowed(opts, "path headers max-early-data early-data-header-name") {
					return p, name, false
				}
				normalized := map[string]any{"type": "ws"}
				for k, v := range opts {
					normalized[strings.ReplaceAll(k, "-", "_")] = v
				}
				if !decodeOption(normalized, tr) {
					return p, name, false
				}
			}
			p.Transport = tr
		case "grpc":
			if _, exists := m["ws-opts"]; exists {
				return p, name, false
			}
			tr := &profileTransport{Type: "grpc"}
			if v, exists := m["grpc-opts"]; exists {
				opts, ok := v.(map[string]any)
				if !ok || !allowed(opts, "grpc-service-name") {
					return p, name, false
				}
				if v, exists := opts["grpc-service-name"]; exists {
					var ok bool
					tr.ServiceName, ok = v.(string)
					if !ok {
						return p, name, false
					}
				}
			}
			p.Transport = tr
		default:
			return p, name, false
		}
	} else {
		p.Method = stringField(m, "method")
		if p.Type == "shadowsocks" {
			if _, exists := m["tls"]; exists {
				return p, name, false
			}
		} else {
			tls, ok := m["tls"].(map[string]any)
			if !ok || !allowed(tls, "enabled server_name insecure alpn utls reality") || tls["enabled"] != true {
				return p, name, false
			}
			if v, exists := tls["insecure"]; exists && v != false {
				return p, name, false
			}
			if v, exists := tls["server_name"]; exists {
				var ok bool
				p.ServerName, ok = v.(string)
				if !ok {
					return p, name, false
				}
			}
			if v, exists := tls["alpn"]; exists {
				if !decodeStrings(v, &p.ALPN) {
					return p, name, false
				}
			}
			if v, exists := tls["utls"]; exists {
				u, ok := v.(map[string]any)
				if !ok || !allowed(u, "enabled fingerprint") || u["enabled"] != true {
					return p, name, false
				}
				p.Fingerprint = "chrome"
				if v, exists := u["fingerprint"]; exists {
					var ok bool
					p.Fingerprint, ok = v.(string)
					if !ok || p.Fingerprint == "" {
						return p, name, false
					}
				}
			}
			if v, exists := tls["reality"]; exists {
				r, ok := v.(map[string]any)
				if !ok || !allowed(r, "enabled public_key short_id") || r["enabled"] != true {
					return p, name, false
				}
				rcopy := map[string]any{}
				for k, v := range r {
					if k != "enabled" {
						rcopy[k] = v
					}
				}
				p.Reality = &profileReality{}
				if !decodeOption(rcopy, p.Reality) {
					return p, name, false
				}
			}
		}
		if v, exists := m["transport"]; exists {
			opts, ok := v.(map[string]any)
			if !ok {
				return p, name, false
			}
			copy := map[string]any{}
			for k, v := range opts {
				copy[k] = v
			}
			if h, exists := copy["headers"]; exists {
				headers, ok := h.(map[string]any)
				if !ok {
					return p, name, false
				}
				normalized := map[string]string{}
				for k, v := range headers {
					var values []string
					if !decodeStrings(v, &values) || len(values) != 1 {
						return p, name, false
					}
					normalized[k] = values[0]
				}
				copy["headers"] = normalized
			}
			p.Transport = &profileTransport{}
			if !decodeOption(copy, p.Transport) {
				return p, name, false
			}
		}
	}
	return p, name, true
}
func decodeOption(value any, target any) bool {
	data, e := json.Marshal(value)
	if e != nil {
		return false
	}
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	return d.Decode(target) == nil
}
func decodeStrings(value any, result *[]string) bool {
	if s, ok := value.(string); ok {
		*result = []string{s}
		return true
	}
	return value != nil && decodeOption(value, result)
}
func parseNodeURI(raw string) map[string]any {
	if strings.HasPrefix(raw, "ss://") && !strings.Contains(strings.SplitN(raw, "#", 2)[0], "@") {
		parts := strings.SplitN(strings.TrimPrefix(raw, "ss://"), "#", 2)
		decoded, e := decodeBase64(parts[0])
		if e != nil {
			return nil
		}
		at := strings.LastIndex(decoded, "@")
		if at < 0 {
			return nil
		}
		credentials := strings.SplitN(decoded[:at], ":", 2)
		if len(credentials) != 2 {
			return nil
		}
		raw = "ss://" + url.UserPassword(credentials[0], credentials[1]).String() + "@" + decoded[at+1:]
		if len(parts) == 2 {
			raw += "#" + parts[1]
		}
	}
	u, e := url.Parse(raw)
	if e != nil || u.User == nil || (u.Path != "" && u.Path != "/") {
		return nil
	}
	port, e := strconv.Atoi(u.Port())
	if u.Port() == "" && (u.Scheme == "hysteria2" || u.Scheme == "hy2" || u.Scheme == "anytls" && !strings.HasSuffix(u.Host, ":")) {
		port, e = 443, nil
	}
	if e != nil {
		return nil
	}
	q, e := url.ParseQuery(u.RawQuery)
	if e != nil {
		return nil
	}
	m := map[string]any{"type": u.Scheme, "server": u.Hostname(), "port": port}
	if u.Fragment != "" {
		m["name"] = u.Fragment
	}
	switch u.Scheme {
	case "anytls":
		if _, hasPassword := u.User.Password(); hasPassword || !utf8.ValidString(u.User.Username()) {
			return nil
		}
		m["password"] = u.User.Username()
		for key, values := range q {
			if len(values) != 1 {
				return nil
			}
			switch key {
			case "sni":
				m["sni"] = values[0]
			case "fp":
				m["client-fingerprint"] = values[0]
			case "type":
				if values[0] != "tcp" {
					return nil
				}
			case "pcs":
				if values[0] != "" {
					return nil
				}
			case "insecure":
				if values[0] != "0" {
					return nil
				}
			default:
				return nil
			}
		}
	case "hysteria2", "hy2":
		return parseHysteria2URI(u, q, m)
	case "ss":
		if len(q) != 0 {
			return nil
		}
		method, password := u.User.Username(), ""
		if pass, yes := u.User.Password(); yes {
			password = pass
		} else {
			decoded, e := decodeBase64(method)
			if e != nil {
				return nil
			}
			parts := strings.SplitN(decoded, ":", 2)
			if len(parts) != 2 {
				return nil
			}
			method, password = parts[0], parts[1]
		}
		m["cipher"], m["password"] = method, password
	case "trojan", "vless":
		if _, yes := u.User.Password(); yes {
			return nil
		}
		// Share-link exporters often serialize inactive UI defaults. Accept only
		// known neutral values; never discard a security option with real meaning.
		for key, values := range q {
			if len(values) != 1 {
				return nil
			}
			switch key {
			case "insecure", "allowInsecure":
				if values[0] != "" && values[0] != "0" && values[0] != "false" {
					return nil
				}
				q.Del(key)
			case "headerType", "quicSecurity":
				if values[0] != "" && values[0] != "none" {
					return nil
				}
				q.Del(key)
			case "pcs":
				if values[0] != "" {
					return nil
				}
				q.Del(key)
			}
		}
		for _, key := range []string{"host", "path", "serviceName", "mode", "ed", "eh"} {
			if q.Has(key) && q.Get(key) == "" {
				q.Del(key)
			}
		}
		for k, v := range q {
			if len(v) != 1 || !containsWord("security type sni encryption fp alpn flow pbk sid path host serviceName mode ed eh", k) {
				return nil
			}
		}
		security := q.Get("security")
		if u.Scheme == "trojan" && security == "" {
			security = "tls"
		}
		if security != "tls" && security != "reality" {
			return nil
		}
		if q.Has("encryption") && (u.Scheme != "vless" || q.Get("encryption") != "none") {
			return nil
		}
		if q.Has("sni") {
			m["sni"] = q.Get("sni")
		}
		if q.Has("fp") {
			m["client-fingerprint"] = q.Get("fp")
		}
		if q.Has("alpn") {
			m["alpn"] = strings.Split(q.Get("alpn"), ",")
		}
		if q.Has("flow") {
			m["flow"] = q.Get("flow")
		}
		if security == "reality" {
			if u.Scheme != "vless" {
				return nil
			}
			m["reality-opts"] = map[string]any{"public-key": q.Get("pbk"), "short-id": q.Get("sid")}
		} else if q.Has("pbk") || q.Has("sid") {
			return nil
		}
		network := q.Get("type")
		if network == "" {
			network = "tcp"
		}
		m["network"] = network
		switch network {
		case "tcp":
			for _, key := range []string{"path", "host", "serviceName", "mode", "ed", "eh"} {
				if q.Has(key) {
					return nil
				}
			}
		case "ws":
			if q.Has("serviceName") || q.Has("mode") {
				return nil
			}
			opts := map[string]any{}
			if q.Has("path") {
				opts["path"] = q.Get("path")
			}
			if q.Has("host") {
				opts["headers"] = map[string]string{"Host": q.Get("host")}
			}
			if q.Has("ed") {
				n, e := strconv.Atoi(q.Get("ed"))
				if e != nil {
					return nil
				}
				opts["max-early-data"] = n
			}
			if q.Has("eh") {
				opts["early-data-header-name"] = q.Get("eh")
			}
			m["ws-opts"] = opts
		case "grpc":
			if q.Has("path") || q.Has("host") || q.Has("ed") || q.Has("eh") || (q.Has("mode") && q.Get("mode") != "gun") {
				return nil
			}
			m["grpc-opts"] = map[string]any{"grpc-service-name": q.Get("serviceName")}
		default:
			return nil
		}
		if u.Scheme == "vless" {
			m["uuid"] = u.User.Username()
			m["tls"] = true
		} else {
			m["password"] = u.User.Username()
		}
	default:
		return nil
	}
	return m
}

func readBundle(raw string) (subscriptionBundle, error) {
	var b subscriptionBundle
	if len(raw) > subscriptionLimit || json.Unmarshal([]byte(raw), &b) != nil || len(b.Revision) != 64 || len(b.Nodes) == 0 || len(b.Nodes) > nodeLimit {
		return b, errors.New("STORAGE_UNAVAILABLE")
	}
	return b, nil
}

// SubscriptionSummary explicitly removes profiles before crossing the JS bridge.
func SubscriptionSummary(raw string) (string, error) {
	b, e := readBundle(raw)
	if e != nil {
		return "", e
	}
	for i := range b.Nodes {
		// Old bundles may mark domain endpoints blocked; derive capabilities
		// from the current validated profile instead of persisting obsolete flags.
		if _, e := parseProfile(string(b.Nodes[i].Profile)); e != nil {
			return "", errors.New("STORAGE_UNAVAILABLE")
		}
		b.Nodes[i].BlockedReason = ""
		b.Nodes[i].Profile = nil
	}
	data, _ := json.Marshal(b)
	return string(data), nil
}
func SubscriptionProfile(raw, revision, nodeID string) (string, error) {
	b, e := readBundle(raw)
	if e != nil {
		return "", e
	}
	if b.Revision != revision {
		return "", errors.New("STALE_SUBSCRIPTION")
	}
	for _, node := range b.Nodes {
		if node.ID == nodeID {
			if _, e := parseProfile(string(node.Profile)); e != nil {
				return "", e
			}
			return string(node.Profile), nil
		}
	}
	return "", errors.New("INVALID_NODE")
}
