// Adapted from sing-box v1.14.4 experimental/libbox/config.go (GPL-3.0-or-later).
// Copyright (C) 2022 nekohasekai and contributors. See docs/licenses/sing-box-LICENSE.txt.
// Hafen change: use an inert monitor for bounded loopback diagnostics, without
// privileged routing sockets or Android package-manager access. NOT a VPN platform.
package mobile

import (
	"context"
	"net/netip"
	"os"

	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/dns"
	"github.com/sagernet/sing-box/option"
	tun "github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/control"
	"github.com/sagernet/sing/common/logger"
	"github.com/sagernet/sing/common/x/list"
)

type diagnosticPlatform struct{}

func (s *diagnosticPlatform) Initialize(networkManager adapter.NetworkManager) error {
	return nil
}

func (s *diagnosticPlatform) UsePlatformAutoDetectInterfaceControl() bool {
	return true
}

func (s *diagnosticPlatform) AutoDetectInterfaceControl(fd int) error {
	return nil
}

func (s *diagnosticPlatform) UsePlatformInterface() bool {
	return false
}

func (s *diagnosticPlatform) OpenInterface(options *tun.Options, platformOptions option.TunPlatformOptions) (tun.Tun, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) ProcessPlatformOptions(options option.TunPlatformOptions) error {
	return nil
}

func (s *diagnosticPlatform) UsePlatformDefaultInterfaceMonitor() bool {
	return true
}

func (s *diagnosticPlatform) CreateDefaultInterfaceMonitor(logger logger.Logger) tun.DefaultInterfaceMonitor {
	return &diagnosticMonitor{}
}

func (s *diagnosticPlatform) UsePlatformNetworkInterfaces() bool {
	return false
}

func (s *diagnosticPlatform) NetworkInterfaces() ([]adapter.NetworkInterface, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) UnderNetworkExtension() bool {
	return false
}

func (s *diagnosticPlatform) NetworkExtensionIncludeAllNetworks() bool {
	return false
}

func (s *diagnosticPlatform) ClearDNSCache() {
}

func (s *diagnosticPlatform) RequestPermissionForWIFIState() error {
	return nil
}

func (s *diagnosticPlatform) UsePlatformWIFIMonitor() bool {
	return false
}

func (s *diagnosticPlatform) ReadWIFIState(ctx context.Context) adapter.WIFIState {
	return adapter.WIFIState{}
}

func (s *diagnosticPlatform) UsePlatformConnectionOwnerFinder() bool {
	return false
}

func (s *diagnosticPlatform) FindConnectionOwner(request *adapter.FindConnectionOwnerRequest) (*adapter.ConnectionOwner, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) UsePlatformNotification() bool {
	return false
}

func (s *diagnosticPlatform) SendNotification(notification *adapter.Notification) error {
	return nil
}

func (s *diagnosticPlatform) CancelNotification(identifier string, typeID int32) error {
	return nil
}

func (s *diagnosticPlatform) MyInterfaceAddress() []netip.Addr {
	return nil
}

func (s *diagnosticPlatform) UsePlatformNeighborResolver() bool {
	return false
}

func (s *diagnosticPlatform) StartNeighborMonitor(listener adapter.NeighborUpdateListener) error {
	return os.ErrInvalid
}

func (s *diagnosticPlatform) CloseNeighborMonitor(listener adapter.NeighborUpdateListener) error {
	return nil
}

func (s *diagnosticPlatform) UsePlatformShell() bool {
	return false
}

func (s *diagnosticPlatform) CheckPlatformShell() error {
	return nil
}

func (s *diagnosticPlatform) OpenShellSession(user *adapter.PlatformUser, command string, env []string, term string, rows int32, cols int32) (adapter.ShellSession, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) LookupSFTPServer() (string, error) {
	return "", os.ErrInvalid
}

func (s *diagnosticPlatform) ReadSystemSSHHostKey() ([]byte, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) TailscaleHostname() string {
	return ""
}

func (s *diagnosticPlatform) UsePlatformBridge() bool {
	return false
}

func (s *diagnosticPlatform) CreateBridge(options adapter.BridgeOptions) (adapter.BridgeSession, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) LookupUser(username string) (*adapter.PlatformUser, error) {
	return nil, os.ErrInvalid
}

func (s *diagnosticPlatform) UsePlatformLocalDNSTransport() bool {
	return false
}

func (s *diagnosticPlatform) LocalDNSTransport() dns.TransportConstructorFunc[option.LocalDNSServerOptions] {
	return nil
}

type diagnosticMonitor struct{}

func (s *diagnosticMonitor) Start() error {
	return nil
}

func (s *diagnosticMonitor) Close() error {
	return nil
}

func (s *diagnosticMonitor) DefaultInterface() *control.Interface {
	return nil
}

func (s *diagnosticMonitor) OverrideAndroidVPN() bool {
	return false
}

func (s *diagnosticMonitor) AndroidVPNEnabled() bool {
	return false
}

func (s *diagnosticMonitor) RegisterCallback(callback tun.DefaultInterfaceUpdateCallback) *list.Element[tun.DefaultInterfaceUpdateCallback] {
	return nil
}

func (s *diagnosticMonitor) UnregisterCallback(element *list.Element[tun.DefaultInterfaceUpdateCallback]) {
}

func (s *diagnosticMonitor) RegisterMyInterface(interfaceName string) {
}

func (s *diagnosticMonitor) MyInterfaces() []string {
	return nil
}
