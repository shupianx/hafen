// Package host exposes only the services used by the iOS application.
// The VPN extension continues to bind the complete mobile package.
package host

import "hafen.local/core/mobile"

func Info() string                                      { return mobile.Info() }
func CheckProfile(content string) error                 { return mobile.CheckProfile(content) }
func SelfTest() (string, error)                         { return mobile.SelfTest() }
func FetchSubscription(url string) (string, error)      { return mobile.FetchSubscription(url) }
func ParseSubscription(content string) (string, error)  { return mobile.ParseSubscription(content) }
func SubscriptionSummary(bundle string) (string, error) { return mobile.SubscriptionSummary(bundle) }
func SubscriptionProfile(bundle, revision, node string) (string, error) {
	return mobile.SubscriptionProfile(bundle, revision, node)
}
