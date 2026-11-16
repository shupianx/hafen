package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"syscall"
	"testing"

	utls "github.com/metacubex/utls"
	mdns "github.com/miekg/dns"
	boxdns "github.com/sagernet/sing-box/dns"
)

func TestProbeHTTPS(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/secret-must-not-follow", http.StatusFound)
			return
		}
		if r.URL.Path == "/secret-must-not-follow" {
			t.Error("followed a redirect")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if result := probeHTTPS(context.Background(), client, server.URL); result != probeResult(true, "NONE") {
		t.Fatal(result)
	}
	if result := probeHTTPS(context.Background(), client, server.URL+"/redirect"); result != probeResult(false, "HTTP") {
		t.Fatal(result)
	}
	if result := probeHTTPS(context.Background(), &http.Client{}, server.URL); result != probeResult(false, "TLS") {
		t.Fatal(result)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if result := probeHTTPS(ctx, client, server.URL); result != probeResult(false, "CLOSED") {
		t.Fatal(result)
	}
}

func TestPacketProbeProtectionAndClose(t *testing.T) {
	content := `{"type":"shadowsocks","server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"secret"}`
	session, err := NewPacketSession(content, testProtector{false})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	var report stagedProbeReport
	if err := json.Unmarshal([]byte(session.Probe()), &report); err != nil {
		t.Fatal(err)
	}
	if report.ProxyError != "PROTECTION" || report.EndpointDNS != "IP" || report.EndpointTCP != "PROTECTION" || report.ProxyHandshake != "NOT_RUN" {
		t.Fatal(report)
	}
	session.Close()
	if err := json.Unmarshal([]byte(session.Probe()), &report); err != nil {
		t.Fatal(err)
	}
	if report.ProxyError != "CLOSED" || report.EndpointDNS != "NOT_RUN" {
		t.Fatal(report)
	}
}

func TestProbeErrorCategories(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{fmt.Errorf("dial private-endpoint: %w", syscall.ECONNREFUSED), "REFUSED"},
		{fmt.Errorf("read private-endpoint: %w", syscall.ECONNRESET), "RESET"},
		{syscall.ENETUNREACH, "UNREACHABLE"},
		{io.ErrUnexpectedEOF, "EOF"},
		{errors.New("private-endpoint: reality verification failed"), "REALITY"},
		{errors.New("private-endpoint: SOCKET_PROTECTION_FAILED"), "PROTECTION"},
		{errors.New("remote error: tls: handshake failure"), "TLS_HANDSHAKE"},
		{&utls.CertificateVerificationError{Err: errors.New("private certificate")}, "TLS"},
		{errors.New("password=secret"), "CONNECT"},
	}
	for _, c := range cases {
		if code := probeErrorCode(c.err); code != c.code {
			t.Fatalf("expected %s got %s", c.code, code)
		}
	}
}

func TestProbeEndpointTCP(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := uint16(listener.Addr().(*net.TCPAddr).Port)
	session := &PacketSession{endpointPort: port, protector: testProtector{true}}
	addresses := []netip.Addr{netip.MustParseAddr("127.0.0.1")}
	if err := session.probeEndpointTCP(context.Background(), addresses); err != nil {
		t.Fatal(err)
	}
	listener.Close()
	if code := probeErrorCode(session.probeEndpointTCP(context.Background(), addresses)); code != "REFUSED" {
		t.Fatal(code)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if code := probeErrorCode(session.probeEndpointTCP(ctx, addresses)); code != "CLOSED" {
		t.Fatal(code)
	}
}
func TestProbeTraceRedactsMessages(t *testing.T) {
	err := fmt.Errorf("password=secret private.example: %w", &net.OpError{Op: "dial", Net: "tcp", Err: syscall.ECONNREFUSED})
	trace := probeErrorTrace(err)
	if strings.Contains(trace, "secret") || strings.Contains(trace, "example") || !strings.Contains(trace, "errno:") {
		t.Fatal(trace)
	}
	if probeErrorCode(boxdns.RcodeError(3)) != "DNS" || probeErrorTrace(boxdns.RcodeError(3)) != "dns-rcode:3" {
		t.Fatal("DNS error classification")
	}
}

func TestProbeBootstrapDNSFailure(t *testing.T) {
	socket, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &mdns.Server{PacketConn: socket, Handler: mdns.HandlerFunc(func(w mdns.ResponseWriter, r *mdns.Msg) {
		reply := new(mdns.Msg)
		reply.SetRcode(r, mdns.RcodeNameError)
		_ = w.WriteMsg(reply)
	})}
	go server.ActivateAndServe()
	defer server.Shutdown()
	var config map[string]any
	_ = json.Unmarshal(tunnelConfig(profile{Type: "shadowsocks", Server: "fixture.invalid", ServerPort: 443, Method: "aes-128-gcm", Password: "secret"}), &config)
	config["dns"] = map[string]any{"servers": []any{map[string]any{"type": "udp", "tag": "bootstrap", "server": "127.0.0.1", "server_port": socket.LocalAddr().(*net.UDPAddr).Port}}, "final": "bootstrap"}
	config["route"] = map[string]any{"auto_detect_interface": true, "final": "proxy", "default_domain_resolver": "bootstrap"}
	raw, _ := json.Marshal(config)
	session, err := newPacketSession(raw, testProtector{true})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	session.endpoint, session.endpointPort = "fixture.invalid", 443
	var report stagedProbeReport
	if err := json.Unmarshal([]byte(session.Probe()), &report); err != nil {
		t.Fatal(err)
	}
	if report.EndpointDNS != "DNS" || report.ProxyError != "DNS" || report.EndpointTCP != "NOT_RUN" || report.ProxyHandshake != "NOT_RUN" {
		t.Fatal(report)
	}
}
