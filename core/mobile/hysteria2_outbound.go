// Adapted from sing-box v1.14.4 protocol/hysteria2/outbound.go.
// Copyright (C) 2022 nekohasekai <contact-sagernet@sekai.icu>
// SPDX-License-Identifier: GPL-3.0-or-later
// Hafen addition: whole-certificate SHA-256 pinning via the public TLS API.
// All QUIC, authentication, obfuscation and relay code remains upstream sing-quic.
package mobile

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"net"
	"os"
	"time"

	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/adapter/outbound"
	"github.com/sagernet/sing-box/common/dialer"
	btls "github.com/sagernet/sing-box/common/tls"
	"github.com/sagernet/sing-box/log"
	"github.com/sagernet/sing-box/option"
	upstream "github.com/sagernet/sing-box/protocol/hysteria2"
	hy2 "github.com/sagernet/sing-quic/hysteria2"
	"github.com/sagernet/sing/common/bufio"
	M "github.com/sagernet/sing/common/metadata"
	N "github.com/sagernet/sing/common/network"
)

type pinnedHysteria2Options struct {
	option.Hysteria2OutboundOptions
	CertificateSHA256 string `json:"certificate_sha256,omitempty"`
}

func registerHysteria2(registry *outbound.Registry) {
	outbound.Register[pinnedHysteria2Options](registry, "hysteria2", newHysteria2Outbound)
}
func newHysteria2Outbound(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, opts pinnedHysteria2Options) (adapter.Outbound, error) {
	o := opts.Hysteria2OutboundOptions
	if opts.CertificateSHA256 == "" {
		return upstream.NewOutbound(ctx, router, logger, tag, o)
	}
	if !validCertificateHash(opts.CertificateSHA256) || o.TLS == nil || !o.TLS.Enabled || o.TLS.Insecure || o.TLS.DisableSNI || len(o.TLS.CertificatePublicKeySHA256) > 0 {
		return nil, errProfile
	}
	// pinSHA256 is a digest of the entire leaf certificate, NOT its public key.
	// Keep normal chain, expiry and hostname verification; add an exact pin check.
	config, e := btls.NewSTDClient(ctx, logger, o.Server, *o.TLS)
	if e != nil {
		return nil, e
	}
	std, e := config.STDConfig()
	if e != nil {
		return nil, e
	}
	expected, _ := hex.DecodeString(opts.CertificateSHA256)
	std.ClientSessionCache = nil
	std.SessionTicketsDisabled = true
	std.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return errors.New("CERTIFICATE_PIN_MISMATCH")
		}
		actual := sha256.Sum256(rawCerts[0])
		if subtle.ConstantTimeCompare(actual[:], expected) != 1 {
			return errors.New("CERTIFICATE_PIN_MISMATCH")
		}
		return nil
	}
	d, e := dialer.NewWithOptions(dialer.Options{Context: ctx, Options: o.DialerOptions, RemoteIsDomain: o.ServerIsDomain()})
	if e != nil {
		return nil, e
	}
	var obfs string
	if o.Obfs != nil {
		if o.Obfs.Type != "salamander" || o.Obfs.Password == "" {
			return nil, errProfile
		}
		obfs = o.Obfs.Password
	}
	client, e := hy2.NewClient(hy2.ClientOptions{Context: ctx, Dialer: d, Logger: logger, ServerAddress: o.ServerOptions.Build(), ServerPorts: o.ServerPorts, HopInterval: time.Duration(o.HopInterval), SendBPS: uint64(o.UpMbps) * 125000, ReceiveBPS: uint64(o.DownMbps) * 125000, SalamanderPassword: obfs, Password: o.Password, TLSConfig: config, ChromeParrot: true})
	if e != nil {
		return nil, e
	}
	return &pinnedHysteria2Outbound{Adapter: outbound.NewAdapterWithDialerOptions("hysteria2", tag, []string{N.NetworkTCP, N.NetworkUDP}, o.DialerOptions), client: client}, nil
}

type pinnedHysteria2Outbound struct {
	outbound.Adapter
	client *hy2.Client
}

func (h *pinnedHysteria2Outbound) DialContext(ctx context.Context, network string, destination M.Socksaddr) (net.Conn, error) {
	switch N.NetworkName(network) {
	case N.NetworkTCP:
		return h.client.DialConn(ctx, destination)
	case N.NetworkUDP:
		c, e := h.ListenPacket(ctx, destination)
		if e != nil {
			return nil, e
		}
		return bufio.NewBindPacketConn(c, destination), nil
	default:
		return nil, errors.New("UNSUPPORTED_NETWORK")
	}
}
func (h *pinnedHysteria2Outbound) ListenPacket(ctx context.Context, _ M.Socksaddr) (net.PacketConn, error) {
	return h.client.ListenPacket(ctx)
}
func (h *pinnedHysteria2Outbound) InterfaceUpdated(context.Context) {
	h.client.CloseWithError(errors.New("NETWORK_CHANGED"))
}
func (h *pinnedHysteria2Outbound) MultiplexEnabled() bool { return true }
func (h *pinnedHysteria2Outbound) SetKeepIdleConnections(keep bool) {
	h.client.SetKeepIdleConnections(keep)
}
func (h *pinnedHysteria2Outbound) CloseIdleConnections() { h.client.CloseIdleConnections() }
func (h *pinnedHysteria2Outbound) Start(stage adapter.StartStage, scope *adapter.Scope) error {
	if stage == adapter.StartStateInitialize {
		scope.Add(func() error { return h.client.CloseWithError(os.ErrClosed) })
	}
	return nil
}
