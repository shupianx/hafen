//go:build tools

// Keep the pinned binding generator's support package available to gomobile.
// It is not part of the mobile runtime; go mod tidy must retain this dependency.
package tools

import _ "github.com/sagernet/gomobile/bind"
