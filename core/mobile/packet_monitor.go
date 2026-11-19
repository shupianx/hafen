//go:build !hafen_host

package mobile

import (
	"errors"
	"net"
	"sync"

	"github.com/sagernet/sing-box/adapter"
	C "github.com/sagernet/sing-box/constant"
	tun "github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/control"
	"github.com/sagernet/sing/common/logger"
	"github.com/sagernet/sing/common/x/list"
)

// packetMonitor describes the same physical interface used by SocketProtector.
// Native owners supply it before starting the core and stop on interface loss.
// This must never inherit diagnosticMonitor's permanently missing interface.
type packetMonitor struct {
	mu        sync.Mutex
	current   *control.Interface
	callbacks list.List[tun.DefaultInterfaceUpdateCallback]
	closed    bool
}

func newPacketMonitor(protector SocketProtector) (*packetMonitor, error) {
	if protector == nil {
		return nil, errors.New("SOCKET_PROTECTOR_REQUIRED")
	}
	name, index := protector.InterfaceName(), int(protector.InterfaceIndex())
	if name == "" || len(name) > 64 || index <= 0 {
		return nil, errors.New("NETWORK_UNAVAILABLE")
	}
	return &packetMonitor{current: &control.Interface{Name: name, Index: index, Flags: net.FlagUp}}, nil
}
func (m *packetMonitor) Start() error { return nil }
func (m *packetMonitor) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	m.current = nil
	m.callbacks.Init()
	return nil
}
func (m *packetMonitor) DefaultInterface() *control.Interface {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil {
		return nil
	}
	result := *m.current
	return &result
}
func (m *packetMonitor) OverrideAndroidVPN() bool { return false }
func (m *packetMonitor) AndroidVPNEnabled() bool  { return false }
func (m *packetMonitor) RegisterCallback(callback tun.DefaultInterfaceUpdateCallback) *list.Element[tun.DefaultInterfaceUpdateCallback] {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}
	return m.callbacks.PushBack(callback)
}
func (m *packetMonitor) UnregisterCallback(element *list.Element[tun.DefaultInterfaceUpdateCallback]) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if element != nil && !m.closed {
		m.callbacks.Remove(element)
	}
}
func (m *packetMonitor) RegisterMyInterface(string) {}
func (m *packetMonitor) MyInterfaces() []string     { return []string{"hafen"} }
func (m *packetMonitor) notify(available bool) {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	if !available {
		m.current = nil
	}
	var current *control.Interface
	if m.current != nil {
		copy := *m.current
		current = &copy
	}
	callbacks := m.callbacks.Array()
	m.mu.Unlock()
	for _, callback := range callbacks {
		callback(current, 0)
	}
}
func (p *packetPlatform) CreateDefaultInterfaceMonitor(logger.Logger) tun.DefaultInterfaceMonitor {
	return p.monitor
}

// RefreshNetwork resets old connections when native reports a path change on
// the same protected interface. Switching interfaces requires a new session.
func (s *PacketSession) RefreshNetwork() error {
	s.lifecycle.RLock()
	defer s.lifecycle.RUnlock()
	if s.closed.Load() {
		return errors.New("TUNNEL_CLOSED")
	}
	current := s.monitor.DefaultInterface()
	if current == nil || current.Name != s.protector.InterfaceName() || current.Index != int(s.protector.InterfaceIndex()) {
		return errors.New("NETWORK_CHANGED")
	}
	// Android already supplies the protected Network's interface via native
	// ConnectivityManager. Go's netlink interface enumeration can be denied in
	// the app sandbox; that must not turn a valid native path into network loss.
	// Outbound binding remains VpnService.protect + Network.bindSocket.
	if !C.IsAndroid {
		if err := s.instance.Network().UpdateInterfaces(); err != nil {
			return errors.New("NETWORK_UNAVAILABLE")
		}
	}
	s.monitor.notify(true)
	return nil
}

// NetworkLost publishes the unavailable state before native tears down routes.
func (s *PacketSession) NetworkLost() {
	s.lifecycle.RLock()
	defer s.lifecycle.RUnlock()
	if !s.closed.Load() {
		s.monitor.notify(false)
	}
}

var _ tun.DefaultInterfaceMonitor = (*packetMonitor)(nil)
var _ adapter.PlatformInterface = (*packetPlatform)(nil)
