package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sagernet/gvisor/pkg/buffer"
	"github.com/sagernet/gvisor/pkg/tcpip"
	"github.com/sagernet/gvisor/pkg/tcpip/header"
	"github.com/sagernet/gvisor/pkg/tcpip/link/channel"
	"github.com/sagernet/gvisor/pkg/tcpip/stack"
	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	C "github.com/sagernet/sing-box/constant"
	"github.com/sagernet/sing-box/option"
	tun "github.com/sagernet/sing-tun"
	boxjson "github.com/sagernet/sing/common/json"
	"github.com/sagernet/sing/service"
	"github.com/sagernet/sing/service/pause"
)

// SocketProtector protects Android sockets or binds iOS sockets to the physical
// interface. False always aborts the dial.
type SocketProtector interface {
	Protect(fd int32) bool
	InterfaceName() string
	InterfaceIndex() int32
}

// PacketSession joins public native packet APIs to sing-box's gVisor stack.
// It owns the engine, not the platform TUN descriptor. No packet crosses JS.
type PacketSession struct {
	monitor          *packetMonitor
	lifecycle        sync.RWMutex
	device           *packetDevice
	instance         *box.Box
	cancel           context.CancelFunc
	once             sync.Once
	closed           atomic.Bool
	probing          atomic.Bool
	ctx              context.Context
	endpoint         string
	endpointPort     uint16
	endpointProtocol string
	protector        SocketProtector
	received         atomic.Uint64
	sent             atomic.Uint64
}

type packetDevice struct{ endpoint *channel.Endpoint }

func (d *packetDevice) Name() (string, error) { return "hafen", nil }
func (d *packetDevice) Start() error          { return nil }
func (d *packetDevice) Close() error          { d.endpoint.Close(); return nil }
func (d *packetDevice) UpdateRouteOptions(tun.Options) error {
	return errors.New("ROUTE_UPDATE_UNSUPPORTED")
}
func (d *packetDevice) Read([]byte) (int, error) { return 0, io.ErrNoProgress }
func (d *packetDevice) Write(b []byte) (int, error) {
	p := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(append([]byte(nil), b...))})
	defer p.DecRef()
	return d.WritePacket(p)
}
func (d *packetDevice) WritePacket(p *stack.PacketBuffer) (int, error) {
	var packets stack.PacketBufferList
	packets.PushBack(p)
	_, err := d.endpoint.WritePackets(packets)
	if err != nil {
		return 0, errors.New("PACKET_QUEUE_UNAVAILABLE")
	}
	return p.Size(), nil
}
func (d *packetDevice) NewEndpoint() (stack.LinkEndpoint, stack.NICOptions, error) {
	return d.endpoint, stack.NICOptions{}, nil
}

// Explicit overrides of the inert platform defaults: actual packet device and
// fail-closed socket protection. Native owners stop the session on network loss.
type packetPlatform struct {
	monitor *packetMonitor
	diagnosticPlatform
	device    *packetDevice
	protector SocketProtector
}

func (p *packetPlatform) UsePlatformInterface() bool               { return true }
func (p *packetPlatform) UnderNetworkExtension() bool              { return C.IsIos }
func (p *packetPlatform) NetworkExtensionIncludeAllNetworks() bool { return C.IsIos }
func (p *packetPlatform) OpenInterface(*tun.Options, option.TunPlatformOptions) (tun.Tun, error) {
	return p.device, nil
}
func (p *packetPlatform) AutoDetectInterfaceControl(fd int) error {
	if !p.protector.Protect(int32(fd)) {
		return errors.New("SOCKET_PROTECTION_FAILED")
	}
	return nil
}

func tunnelConfig(p profile) []byte {
	var config map[string]any
	_ = json.Unmarshal(profileConfig(p), &config)
	config["inbounds"] = []any{map[string]any{"type": "tun", "tag": "vpn", "interface_name": "hafen", "address": []string{"172.19.0.1/30", "fdfe:dcba:9876::1/126"}, "mtu": 1500, "stack": "gvisor", "auto_route": false, "dns_mode": "hijack", "dns_address": []string{"172.19.0.2", "fdfe:dcba:9876::2"}}}
	// Only endpoint resolution uses direct, protected DoH. Application DNS
	// remains on remote DoH through proxy, with no local/cleartext fallback.
	proxy := config["outbounds"].([]any)[0].(map[string]any)
	proxy["domain_resolver"] = map[string]any{"server": "bootstrap", "strategy": "prefer_ipv4"}
	proxy["connect_timeout"] = "10s"
	config["dns"] = map[string]any{"servers": []any{
		map[string]any{"type": "https", "tag": "bootstrap", "server": "1.1.1.1", "server_port": 443, "path": "/dns-query", "tls": map[string]any{"enabled": true, "server_name": "cloudflare-dns.com"}, "connect_timeout": "10s"},
		map[string]any{"type": "https", "tag": "remote", "server": "1.1.1.1", "server_port": 443, "path": "/dns-query", "tls": map[string]any{"enabled": true, "server_name": "cloudflare-dns.com"}, "detour": "proxy"},
	}, "final": "remote"}
	config["route"] = map[string]any{"auto_detect_interface": true, "final": "proxy", "default_domain_resolver": "remote", "rules": []any{map[string]any{"port": 53, "action": "hijack-dns"}}}
	result, _ := json.Marshal(config)
	return result
}

// NewPacketSession does not install system routes. The native owner must install
// matching MTU/addresses/DNS and call Close on every failure and stop path.
func NewPacketSession(content string, protector SocketProtector) (*PacketSession, error) {
	p, err := parseProfile(content)
	if err != nil {
		return nil, err
	}
	if protector == nil {
		return nil, errors.New("SOCKET_PROTECTOR_REQUIRED")
	}
	session, err := newPacketSession(tunnelConfig(p), protector)
	if err != nil {
		return nil, errors.New("CORE_START_FAILED")
	}
	session.endpoint, session.endpointPort, session.endpointProtocol = p.Server, p.ServerPort, p.Type
	return session, nil
}
func newPacketSession(content []byte, protector SocketProtector) (*PacketSession, error) {
	configurePacketRuntime()
	if !tun.WithGVisor {
		return nil, errors.New("PACKET_ENGINE_UNAVAILABLE")
	}
	monitor, err := newPacketMonitor(protector)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(coreContext())
	d := &packetDevice{endpoint: channel.New(256, 1500, "")}
	platform := &packetPlatform{device: d, protector: protector, monitor: monitor}
	ctx = service.ContextWith[adapter.PlatformInterface](ctx, platform)
	options, err := boxjson.UnmarshalExtendedContext[option.Options](ctx, content)
	if err != nil {
		cancel()
		d.Close()
		return nil, errors.New("CORE_CONFIGURATION_FAILED")
	}
	instance, err := box.New(box.Options{Options: options, Context: ctx})
	if err != nil {
		cancel()
		d.Close()
		return nil, errors.New("CORE_CONFIGURATION_FAILED")
	}
	s := &PacketSession{device: d, instance: instance, ctx: ctx, cancel: cancel, protector: protector, monitor: monitor}
	if err = instance.Start(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

// SubmitPacket copies a single raw IPv4/IPv6 packet. No utun header is expected.
func (s *PacketSession) SubmitPacket(data []byte) error {
	s.lifecycle.RLock()
	defer s.lifecycle.RUnlock()
	if s.closed.Load() {
		return errors.New("TUNNEL_CLOSED")
	}
	var proto tcpip.NetworkProtocolNumber
	if len(data) < 20 || len(data) > 1500 {
		return errors.New("INVALID_PACKET")
	}
	switch data[0] >> 4 {
	case 4:
		proto = header.IPv4ProtocolNumber
	case 6:
		if len(data) < 40 {
			return errors.New("INVALID_PACKET")
		}
		proto = header.IPv6ProtocolNumber
	default:
		return errors.New("INVALID_PACKET")
	}
	packet := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(append([]byte(nil), data...))})
	defer packet.DecRef()
	s.device.endpoint.InjectInbound(proto, packet)
	s.received.Add(1)
	return nil
}

// NextPacket blocks for at most one second. An empty result means timeout; Close
// interrupts it. A bounded channel prevents a slow native writer growing memory.
func (s *PacketSession) NextPacket() ([]byte, error) {
	if s.closed.Load() {
		return nil, errors.New("TUNNEL_CLOSED")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	p := s.device.endpoint.ReadContext(ctx)
	if p == nil {
		if s.closed.Load() {
			return nil, errors.New("TUNNEL_CLOSED")
		}
		return nil, nil
	}
	defer p.DecRef()
	var data []byte
	for _, part := range p.AsSlices() {
		data = append(data, part...)
	}
	s.sent.Add(1)
	return data, nil
}
func (s *PacketSession) Stats() string {
	b, _ := json.Marshal(map[string]any{"running": !s.closed.Load(), "packetsIn": s.received.Load(), "packetsOut": s.sent.Load(), "networkAvailable": s.monitor.DefaultInterface() != nil, "networkPaused": service.FromContext[pause.Manager](s.ctx).IsNetworkPaused()})
	return string(b)
}
func (s *PacketSession) Close() error {
	var err error
	s.once.Do(func() {
		s.lifecycle.Lock()
		defer s.lifecycle.Unlock()
		s.closed.Store(true)
		s.cancel()
		s.device.Close()
		if s.instance.Close() != nil {
			err = errors.New("CORE_CLOSE_FAILED")
		}
	})
	return err
}
