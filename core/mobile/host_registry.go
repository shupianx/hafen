//go:build hafen_host

package mobile

import "github.com/sagernet/sing-box/adapter/inbound"

// Hosts validate real outbounds and run the bounded SS diagnostic, but never
// create a system TUN. Keep packet-engine registration in the extension.
func registerPacketInbound(*inbound.Registry) {}
