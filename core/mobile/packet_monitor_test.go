package mobile

import (
	"github.com/sagernet/sing/common/control"
	"github.com/sagernet/sing/service"
	"github.com/sagernet/sing/service/pause"
	"sync"
	"testing"
)

type missingNetworkProtector struct{ testProtector }

func (p missingNetworkProtector) InterfaceIndex() int32 { return 0 }

func TestPacketNetworkLifecycle(t *testing.T) {
	profile := `{"type":"shadowsocks","server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"fixture"}`
	if s, e := NewPacketSession(profile, missingNetworkProtector{}); e == nil {
		s.Close()
		t.Fatal("started without a physical interface")
	}
	s, e := NewPacketSession(profile, testProtector{true})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	manager := service.FromContext[pause.Manager](s.ctx)
	actual := s.instance.Network().InterfaceMonitor().DefaultInterface()
	if actual == nil || actual.Index != int(testProtector{}.InterfaceIndex()) || manager.IsNetworkPaused() {
		t.Fatal("live network was marked missing/paused")
	}
	// Callers must not be able to change the monitor's internal snapshot.
	actual.Index = 0
	if s.monitor.DefaultInterface().Index == 0 {
		t.Fatal("mutable snapshot escaped")
	}
	if e = s.RefreshNetwork(); e != nil {
		t.Fatal(e)
	}
	if manager.IsNetworkPaused() {
		t.Fatal("refresh paused a live network")
	}
	s.NetworkLost()
	if !manager.IsNetworkPaused() || s.monitor.DefaultInterface() != nil {
		t.Fatal("lost network remained available")
	}
	if s.RefreshNetwork() == nil {
		t.Fatal("refresh resurrected a lost protected interface")
	}
	s.Close()
	if s.RefreshNetwork() == nil {
		t.Fatal("closed session accepted update")
	}
}

func TestPacketMonitorCallbacksAndClose(t *testing.T) {
	m, e := newPacketMonitor(testProtector{true})
	if e != nil {
		t.Fatal(e)
	}
	count := 0
	element := m.RegisterCallback(func(iif *control.Interface, _ int) {
		count++
		// Calling back into the monitor must not deadlock.
		if (iif == nil) != (m.DefaultInterface() == nil) {
			t.Error("stale interface notification")
		}
	})
	m.notify(true)
	m.notify(false)
	m.UnregisterCallback(element)
	m.notify(false)
	if count != 2 {
		t.Fatal(count)
	}
	m.Close()
	m.UnregisterCallback(element)
	if m.RegisterCallback(func(*control.Interface, int) { t.Fatal("callback after close") }) != nil {
		t.Fatal("registered after close")
	}
	m.notify(true)
}

func TestPacketNetworkCloseRace(t *testing.T) {
	s, e := NewPacketSession(`{"type":"shadowsocks","server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"fixture"}`, testProtector{true})
	if e != nil {
		t.Fatal(e)
	}
	var work sync.WaitGroup
	for range 4 {
		work.Go(func() {
			for range 10 {
				_ = s.RefreshNetwork()
				_ = s.Stats()
			}
		})
	}
	work.Go(func() { s.NetworkLost(); s.Close() })
	work.Wait()
}
