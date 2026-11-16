package mobile

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
	"time"

	"github.com/sagernet/sing-box/adapter"
	M "github.com/sagernet/sing/common/metadata"
)

var diagnosticLock sync.Mutex

// SelfTest sends a random payload through a real sing-box Shadowsocks client
// and server on localhost. It never accesses a subscription or changes routes.
// This is an engine diagnostic, NOT a VPN connectivity/leak test.
func SelfTest() (string, error) {
	if !diagnosticLock.TryLock() {
		return "", errors.New("OPERATION_IN_PROGRESS")
	}
	defer diagnosticLock.Unlock()
	if err := selfTest(); err != nil {
		return "", errors.New("CORE_SELF_TEST_FAILED")
	}
	return `{"ok":true,"scope":"loopback-shadowsocks-tcp","vpnConnected":false}`, nil
}

func selfTest() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	origin, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer origin.Close()
	proxyListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer proxyListener.Close()
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return err
	}
	password := hex.EncodeToString(secret)
	config, _ := json.Marshal(map[string]any{
		"log": map[string]any{"disabled": true},
		"inbounds": []any{map[string]any{
			"type": "shadowsocks", "tag": "test-server", "listen": "127.0.0.1", "listen_port": 0,
			"network": "tcp", "method": "aes-128-gcm", "password": password,
		}},
		"outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}},
		"route":     map[string]any{"final": "direct"},
	})
	server, serverCancel, err := newInstance(config)
	if err != nil {
		return err
	}
	defer serverCancel()
	defer server.Close()
	if err = server.Start(); err != nil {
		return err
	}
	serverInbound, found := server.Inbound().Get("test-server")
	if !found {
		return errors.New("missing inbound")
	}
	injectable, ok := serverInbound.(adapter.TCPInjectableInbound)
	if !ok {
		return errors.New("missing connection handler")
	}
	var workers sync.WaitGroup
	workers.Add(2)
	// Close listeners before waiting, including error paths where nobody dialed.
	defer workers.Wait()
	defer origin.Close()
	defer proxyListener.Close()
	go func() {
		defer workers.Done()
		connection, acceptErr := origin.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
		_, _ = io.Copy(connection, connection)
	}()
	go func() {
		defer workers.Done()
		connection, acceptErr := proxyListener.Accept()
		if acceptErr != nil {
			return
		}
		_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
		injectable.NewConnection(ctx, connection, adapter.InboundContext{
			Inbound: "test-server", InboundType: "shadowsocks", Network: "tcp",
			Source: M.SocksaddrFromNet(connection.RemoteAddr()),
		}, func(_ error) { connection.Close() })
	}()
	client, clientCancel, err := newInstance(profileConfig(profile{
		Type: "shadowsocks", Server: "127.0.0.1", ServerPort: uint16(proxyListener.Addr().(*net.TCPAddr).Port),
		Method: "aes-128-gcm", Password: password,
	}))
	if err != nil {
		return err
	}
	defer clientCancel()
	defer client.Close()
	if err = client.Start(); err != nil {
		return err
	}
	proxy, found := client.Outbound().Outbound("proxy")
	if !found {
		return errors.New("missing outbound")
	}
	connection, err := proxy.DialContext(ctx, "tcp", M.SocksaddrFromNet(origin.Addr()))
	if err != nil {
		return err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
	payload := make([]byte, 4096)
	if _, err = rand.Read(payload); err != nil {
		return err
	}
	if _, err = connection.Write(payload); err != nil {
		return err
	}
	reply := make([]byte, len(payload))
	if _, err = io.ReadFull(connection, reply); err != nil {
		return err
	}
	if !bytes.Equal(payload, reply) {
		return errors.New("payload mismatch")
	}
	return nil
}
