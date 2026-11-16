package com.hafen.platform

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class HafenPlatformPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == HafenPlatformModule.NAME) HafenPlatformModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(HafenPlatformModule.NAME to ReactModuleInfo(
      HafenPlatformModule.NAME, HafenPlatformModule::class.java.name,
      false, false, false, true
    ))
  }
}
