package mobile

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	utls "github.com/metacubex/utls"
	"github.com/sagernet/sing-box/adapter"
	C "github.com/sagernet/sing-box/constant"
	boxdns "github.com/sagernet/sing-box/dns"
	M "github.com/sagernet/sing/common/metadata"
	"github.com/sagernet/sing/service"
)

type stagedProbeReport struct {
	ProxyHTTPS     bool   `json:"proxyHTTPS"`
	ProxyError     string `json:"proxyError"`
	EndpointDNS    string `json:"endpointDNS"`
	EndpointTCP    string `json:"endpointTCP"`
	ProxyHandshake string `json:"proxyHandshake"`
	TargetTLS      string `json:"targetTLS"`
	ErrorTrace     string `json:"errorTrace"`
}

func (r stagedProbeReport) json() string { b, _ := json.Marshal(r); return string(b) }
func newProbeReport() stagedProbeReport {
	return stagedProbeReport{ProxyError: "UNAVAILABLE", EndpointDNS: "NOT_RUN", EndpointTCP: "NOT_RUN", ProxyHandshake: "NOT_RUN", TargetTLS: "NOT_RUN"}
}

// Probe separates bootstrap DNS, protected endpoint TCP, proxy setup, and
// target TLS/HTTP. It never changes the selected node or adds a direct fallback.
func (s *PacketSession) Probe() string {
	report := newProbeReport()
	if !s.probing.CompareAndSwap(false, true) {
		report.ProxyError = "BUSY"
		return report.json()
	}
	defer s.probing.Store(false)
	if s.closed.Load() {
		report.ProxyError = "CLOSED"
		return report.json()
	}
	ctx, cancel := context.WithTimeout(s.ctx, 24*time.Second)
	defer cancel()
	if err := s.probeEndpoint(ctx, &report); err != nil {
		report.ProxyError = probeErrorCode(err)
		report.ErrorTrace = probeErrorTrace(err)
		return report.json()
	}
	outbound, ok := s.instance.Outbound().Outbound("proxy")
	if !ok {
		report.ProxyError = "CONNECT"
		return report.json()
	}
	var mu sync.Mutex
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			conn, err := outbound.DialContext(ctx, network, M.ParseSocksaddr(address))
			mu.Lock()
			report.ProxyHandshake = "NONE"
			if err != nil {
				report.ProxyHandshake = probeErrorCode(err)
			}
			mu.Unlock()
			return conn, err
		}, TLSHandshakeTimeout: 8 * time.Second, DisableKeepAlives: true, MaxResponseHeaderBytes: 8192,
	}
	defer transport.CloseIdleConnections()
	trace := &httptrace.ClientTrace{TLSHandshakeDone: func(_ tls.ConnectionState, err error) {
		mu.Lock()
		defer mu.Unlock()
		report.TargetTLS = "NONE"
		if err != nil {
			report.TargetTLS = probeErrorCode(err)
		}
	}}
	requestCtx, requestCancel := context.WithTimeout(httptrace.WithClientTrace(ctx, trace), 12*time.Second)
	defer requestCancel()
	request, _ := http.NewRequestWithContext(requestCtx, http.MethodGet, "https://1.1.1.1/cdn-cgi/trace", nil)
	response, err := (&http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(request)
	if response != nil {
		response.Body.Close()
	}
	mu.Lock()
	defer mu.Unlock()
	if err != nil {
		report.ProxyError = probeErrorCode(err)
		report.ErrorTrace = probeErrorTrace(err)
	} else if response.StatusCode != http.StatusOK {
		report.ProxyError = "HTTP"
	} else {
		report.ProxyHTTPS = true
		report.ProxyError = "NONE"
	}
	return report.json()
}

func (s *PacketSession) probeEndpoint(ctx context.Context, report *stagedProbeReport) error {
	if s.endpoint == "" {
		report.EndpointDNS = "SKIPPED"
		report.EndpointTCP = "SKIPPED"
		return nil
	}
	ip, err := netip.ParseAddr(s.endpoint)
	addresses := []netip.Addr{ip}
	if err == nil {
		report.EndpointDNS = "IP"
	} else {
		router := service.FromContext[adapter.DNSRouter](s.ctx)
		manager := service.FromContext[adapter.DNSTransportManager](s.ctx)
		if router == nil || manager == nil {
			report.EndpointDNS = "UNAVAILABLE"
			return errors.New("DNS_SERVICE_UNAVAILABLE")
		}
		transport, ok := manager.Transport("bootstrap")
		if !ok {
			report.EndpointDNS = "UNAVAILABLE"
			return errors.New("DNS_SERVICE_UNAVAILABLE")
		}
		dnsCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
		addresses, err = router.Lookup(dnsCtx, s.endpoint, adapter.DNSQueryOptions{Transport: transport, Strategy: C.DomainStrategyPreferIPv4, DisableCache: true})
		cancel()
		if err == nil && len(addresses) == 0 {
			err = errors.New("DNS_EMPTY_RESPONSE")
		}
		if err != nil {
			report.EndpointDNS = probeErrorCode(err)
			return err
		}
		report.EndpointDNS = "NONE"
	}
	if s.endpointProtocol == "hysteria2" {
		report.EndpointTCP = "SKIPPED"
		return nil
	}
	err = s.probeEndpointTCP(ctx, addresses)
	report.EndpointTCP = "NONE"
	if err != nil {
		report.EndpointTCP = probeErrorCode(err)
	}
	return err
}
func (s *PacketSession) probeEndpointTCP(ctx context.Context, addresses []netip.Addr) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if len(addresses) > 4 {
		addresses = addresses[:4]
	}
	results := make(chan error, len(addresses))
	dialer := net.Dialer{Control: func(_, _ string, raw syscall.RawConn) error {
		var protectError error
		err := raw.Control(func(fd uintptr) {
			if s.protector == nil || !s.protector.Protect(int32(fd)) {
				protectError = errors.New("SOCKET_PROTECTION_FAILED")
			}
		})
		if err != nil {
			return err
		}
		return protectError
	}}
	for _, address := range addresses {
		go func(ip netip.Addr) {
			conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), strconv.Itoa(int(s.endpointPort))))
			if conn != nil {
				conn.Close()
			}
			results <- err
		}(address)
	}
	var last error
	for range addresses {
		select {
		case err := <-results:
			if err == nil {
				return nil
			}
			last = err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return last
}

// Error types and numeric errno/rcode only. No original error text, addresses,
// domains, usernames, credentials, or response bodies cross the native bridge.
func probeErrorTrace(err error) string {
	var parts []string
	for depth := 0; err != nil && depth < 5; depth++ {
		name := fmt.Sprintf("%T", err)
		if value, ok := err.(syscall.Errno); ok {
			name = "errno:" + strconv.Itoa(int(value))
		}
		if value, ok := err.(boxdns.RcodeError); ok {
			name = "dns-rcode:" + strconv.Itoa(int(value))
		}
		parts = append(parts, name)
		err = errors.Unwrap(err)
	}
	result := strings.Join(parts, " > ")
	if len(result) > 200 {
		result = result[:200]
	}
	return result
}

func probeHTTPS(parent context.Context, client *http.Client, target string) string {
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return probeResult(false, "CONNECT")
	}
	response, err := client.Do(request)
	if err != nil {
		return probeResult(false, probeErrorCode(err))
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return probeResult(false, "HTTP")
	}
	return probeResult(true, "NONE")
}

// Match only fixed categories. Never return the error message, which may carry
// endpoint addresses or authentication material from an upstream library.
func probeErrorCode(err error) string {
	var timeout net.Error
	var dnsError *net.DNSError
	var tlsError *tls.CertificateVerificationError
	var utlsError *utls.CertificateVerificationError
	var unknownCA x509.UnknownAuthorityError
	var rcode boxdns.RcodeError
	switch {
	case errors.Is(err, context.Canceled):
		return "CLOSED"
	case strings.Contains(err.Error(), "SOCKET_PROTECTION_FAILED"):
		return "PROTECTION"
	case strings.Contains(err.Error(), "reality verification failed"):
		return "REALITY"
	case errors.As(err, &rcode), strings.Contains(err.Error(), "DNS_EMPTY_RESPONSE"), strings.Contains(err.Error(), "DNS_SERVICE_UNAVAILABLE"):
		return "DNS"
	case errors.As(err, &dnsError):
		return "DNS"
	case errors.As(err, &tlsError), errors.As(err, &utlsError), errors.As(err, &unknownCA):
		return "TLS"
	case errors.As(err, &timeout) && timeout.Timeout():
		return "TIMEOUT"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "REFUSED"
	case errors.Is(err, syscall.ECONNRESET):
		return "RESET"
	case errors.Is(err, syscall.ENETUNREACH), errors.Is(err, syscall.EHOSTUNREACH), errors.Is(err, syscall.ENETDOWN), errors.Is(err, syscall.EADDRNOTAVAIL):
		return "UNREACHABLE"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "EOF"
	case strings.Contains(err.Error(), "tls:"):
		return "TLS_HANDSHAKE"
	default:
		return "CONNECT"
	}
}

func probeResult(ok bool, code string) string {
	data, _ := json.Marshal(map[string]any{"proxyHTTPS": ok, "proxyError": code})
	return string(data)
}
