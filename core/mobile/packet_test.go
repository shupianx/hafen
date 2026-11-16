package mobile

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/sagernet/gvisor/pkg/buffer"
	"github.com/sagernet/gvisor/pkg/tcpip"
	"github.com/sagernet/gvisor/pkg/tcpip/adapters/gonet"
	"github.com/sagernet/gvisor/pkg/tcpip/header"
	"github.com/sagernet/gvisor/pkg/tcpip/link/channel"
	"github.com/sagernet/gvisor/pkg/tcpip/network/ipv4"
	"github.com/sagernet/gvisor/pkg/tcpip/network/ipv6"
	"github.com/sagernet/gvisor/pkg/tcpip/stack"
	"github.com/sagernet/gvisor/pkg/tcpip/transport/tcp"
	"github.com/sagernet/gvisor/pkg/tcpip/transport/udp"
)

type testProtector struct{ allow bool }

func (p testProtector) InterfaceName() string { return testLoopback().Name }
func (p testProtector) InterfaceIndex() int32 { return int32(testLoopback().Index) }
func testLoopback() net.Interface {
	interfaces, _ := net.Interfaces()
	for _, iif := range interfaces {
		if iif.Flags&net.FlagLoopback != 0 {
			return iif
		}
	}
	return net.Interface{}
}
func (p testProtector) Protect(int32) bool { return p.allow }

func TestPacketSessionPolicyAndClose(t *testing.T) {
	domain, err := NewPacketSession(`{"type":"shadowsocks","server":"example.com","server_port":443,"method":"aes-128-gcm","password":"secret"}`, testProtector{true})
	if err != nil {
		t.Fatal("domain profile should construct without DNS I/O", err)
	}
	domain.Close()
	s, err := NewPacketSession(`{"type":"shadowsocks","server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"secret"}`, testProtector{true})
	if err != nil {
		t.Fatal(err)
	}
	if s.SubmitPacket([]byte{1, 2, 3}) == nil {
		t.Fatal("accepted malformed packet")
	}
	done := make(chan struct{})
	go func() { defer close(done); _, _ = s.NextPacket() }()
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("read did not stop")
	}
	if s.SubmitPacket(make([]byte, 20)) == nil {
		t.Fatal("closed session accepted data")
	}
}

// A second upstream gVisor stack acts as a device. This tests IPv4/IPv6 TCP
// and UDP through the same packet API used by Android and public iOS packetFlow.
func TestPacketTCPUDPAndProtection(t *testing.T) {
	for _, tc := range []struct {
		mode  string
		allow bool
		ipv6  bool
	}{{"direct", true, false}, {"direct", false, false}, {"hysteria2", true, false}, {"hysteria2", false, false}, {"vless", true, false}, {"vless", false, false}, {"vless-ws", true, false}, {"direct", true, true}, {"hysteria2", true, true}, {"vless", true, true}, {"vless-ws", true, true}} {
		allow, mode := tc.allow, tc.mode
		t.Run(mode+"/"+map[bool]string{true: "ipv6", false: "ipv4"}[tc.ipv6]+"/"+map[bool]string{true: "forward", false: "protect-failure"}[allow], func(t *testing.T) {
			origin, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer origin.Close()
			udpOrigin, err := net.ListenPacket("udp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer udpOrigin.Close()
			go func() {
				for {
					c, e := origin.Accept()
					if e != nil {
						return
					}
					go func() { defer c.Close(); c.SetDeadline(time.Now().Add(3 * time.Second)); io.Copy(c, c) }()
				}
			}()
			go func() {
				b := make([]byte, 1500)
				for {
					n, a, e := udpOrigin.ReadFrom(b)
					if e != nil {
						return
					}
					udpOrigin.WriteTo(b[:n], a)
				}
			}()
			var config map[string]any
			json.Unmarshal(tunnelConfig(profile{Type: "shadowsocks", Server: "127.0.0.1", ServerPort: 443, Method: "aes-128-gcm", Password: "test"}), &config)
			// Isolate packet adaptation from proxy encryption, which SelfTest separately exercises.
			delete(config, "dns")
			config["outbounds"] = []any{map[string]any{"type": "direct", "tag": "proxy"}}
			config["route"] = map[string]any{"auto_detect_interface": true, "final": "proxy", "rules": []any{map[string]any{"ip_cidr": []string{"198.18.0.1/32", "2001:db8::1/128"}, "action": "route", "outbound": "proxy", "override_address": "127.0.0.1"}}}

			if mode == "hysteria2" {
				cert, key, certificate := testCertificate(t)
				hash := sha256.Sum256(certificate.Certificate[0])
				port := udpTestPort(t)
				p := profile{Type: "hysteria2", Server: "127.0.0.1", ServerPort: uint16(port), ServerName: "proxy.test", Password: "packet-test", CertificateSHA256: hex.EncodeToString(hash[:]), Obfs: &profileObfs{Type: "salamander", Password: "packet-obfs"}}
				testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{map[string]any{"type": "hysteria2", "tag": "hy2", "listen": "127.0.0.1", "listen_port": port, "users": []any{map[string]any{"password": p.Password}}, "obfs": p.Obfs, "tls": map[string]any{"enabled": true, "certificate": []string{cert}, "key": []string{key}}}}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct", "rules": []any{map[string]any{"ip_cidr": []string{"198.18.0.1/32", "2001:db8::1/128"}, "action": "route", "outbound": "direct", "override_address": "127.0.0.1"}}}})
				json.Unmarshal(tunnelConfig(p), &config)
				config["outbounds"].([]any)[0].(map[string]any)["tls"].(map[string]any)["certificate"] = []string{cert}
			}

			if mode == "vless" || mode == "vless-ws" {
				cert, key, _ := testCertificate(t)
				port := testPort(t)
				p := profile{Type: "vless", Server: "127.0.0.1", ServerPort: uint16(port), ServerName: "proxy.test", UUID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
				inbound := map[string]any{"type": "vless", "tag": "vless", "listen": "127.0.0.1", "listen_port": port, "users": []any{map[string]any{"uuid": p.UUID}}, "tls": map[string]any{"enabled": true, "certificate": []string{cert}, "key": []string{key}}}
				if mode == "vless-ws" {
					p.Transport = &profileTransport{Type: "ws", Path: "/tunnel"}
					inbound["transport"] = p.Transport
				}
				testInstance(t, map[string]any{"log": map[string]any{"disabled": true}, "inbounds": []any{inbound}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct", "rules": []any{map[string]any{"ip_cidr": []string{"198.18.0.1/32", "2001:db8::1/128"}, "action": "route", "outbound": "direct", "override_address": "127.0.0.1"}}}})
				json.Unmarshal(tunnelConfig(p), &config)
				config["outbounds"].([]any)[0].(map[string]any)["tls"].(map[string]any)["certificate"] = []string{cert}
			}
			encoded, _ := json.Marshal(config)
			session, err := newPacketSession(encoded, testProtector{allow})
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			client := stack.New(stack.Options{NetworkProtocols: []stack.NetworkProtocolFactory{ipv4.NewProtocol, ipv6.NewProtocol}, TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol, udp.NewProtocol}})
			defer client.Close()
			ep := channel.New(256, 1500, "")
			defer ep.Close()
			if err := client.CreateNIC(1, ep); err != nil {
				t.Fatal(err)
			}
			protocol := ipv4.ProtocolNumber
			source := tcpip.AddrFrom4([4]byte{172, 19, 0, 1})
			destination := tcpip.AddrFrom4([4]byte{198, 18, 0, 1})
			subnet := header.IPv4EmptySubnet
			if tc.ipv6 {
				protocol = ipv6.ProtocolNumber
				source = tcpip.AddrFrom16([16]byte{0xfd, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1})
				destination = tcpip.AddrFrom16([16]byte{0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1})
				subnet = header.IPv6EmptySubnet
			}
			if err := client.AddProtocolAddress(1, tcpip.ProtocolAddress{Protocol: protocol, AddressWithPrefix: source.WithPrefix()}, stack.AddressProperties{}); err != nil {
				t.Fatal(err)
			}
			client.SetRouteTable([]tcpip.Route{{Destination: subnet, NIC: 1}})
			ctx, cancel := context.WithCancel(context.Background())
			var wg sync.WaitGroup
			wg.Add(2)
			defer func() { cancel(); session.Close(); wg.Wait() }()
			go func() {
				defer wg.Done()
				for {
					p := ep.ReadContext(ctx)
					if p == nil {
						return
					}
					var bytes []byte
					for _, part := range p.AsSlices() {
						bytes = append(bytes, part...)
					}
					p.DecRef()
					if session.SubmitPacket(bytes) != nil {
						return
					}
				}
			}()
			go func() {
				defer wg.Done()
				for {
					data, err := session.NextPacket()
					if err != nil {
						return
					}
					if len(data) == 0 {
						continue
					}
					p := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(data)})
					ep.InjectInbound(protocol, p)
					p.DecRef()
				}
			}()
			dialCtx, dialCancel := context.WithTimeout(ctx, 2*time.Second)
			defer dialCancel()
			address := tcpip.FullAddress{NIC: 1, Addr: destination, Port: uint16(origin.Addr().(*net.TCPAddr).Port)}
			conn, err := gonet.DialContextTCP(dialCtx, client, address, protocol)
			if !allow {
				if err == nil {
					conn.SetDeadline(time.Now().Add(time.Second))
					_, _ = conn.Write([]byte("must-not-forward"))
					b := make([]byte, 16)
					n, _ := conn.Read(b)
					conn.Close()
					if n > 0 {
						t.Fatal("failed protection still forwarded")
					}
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			conn.SetDeadline(time.Now().Add(2 * time.Second))
			payload := []byte("hafen-packet-tcp")
			if _, err = conn.Write(payload); err != nil {
				t.Fatal(err)
			}
			b := make([]byte, len(payload))
			if _, err = io.ReadFull(conn, b); err != nil || string(b) != string(payload) {
				t.Fatal("TCP echo", err)
			}
			address.Port = uint16(udpOrigin.LocalAddr().(*net.UDPAddr).Port)
			uc, err := gonet.DialUDP(client, nil, &address, protocol)
			if err != nil {
				t.Fatal(err)
			}
			defer uc.Close()
			uc.SetDeadline(time.Now().Add(2 * time.Second))
			if _, err = uc.Write([]byte("hafen-packet-udp")); err != nil {
				t.Fatal(err)
			}
			b = make([]byte, 64)
			n, err := uc.Read(b)
			if err != nil || string(b[:n]) != "hafen-packet-udp" {
				t.Fatal("UDP echo", err)
			}
		})
	}
}
