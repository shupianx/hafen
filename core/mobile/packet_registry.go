//go:build !hafen_host

package mobile

import (
	"github.com/sagernet/sing-box/adapter/inbound"
	tunneling "github.com/sagernet/sing-box/protocol/tun"
)

func registerPacketInbound(registry *inbound.Registry) { tunneling.RegisterInbound(registry) }
