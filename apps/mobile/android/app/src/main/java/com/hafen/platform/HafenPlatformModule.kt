package com.hafen.platform

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import com.hafen.core.mobile.Mobile
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class HafenPlatformModule(private val context: ReactApplicationContext) : NativeHafenPlatformSpec(context), LifecycleEventListener {
  private val vpnRequests = java.util.concurrent.atomic.AtomicLong()
  private val worker = Executors.newSingleThreadExecutor()
  private val vault = SubscriptionVault(context)
  private var pendingPermission: Promise? = null
  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != VPN_REQUEST) return
      val pending = pendingPermission ?: return
      pendingPermission = null
      pending.resolve(VpnService.prepare(context) == null)
    }
  }

  init {
    context.addActivityEventListener(activityListener)
    context.addLifecycleEventListener(this)
  }

  override fun getName() = NAME

  override fun getEnvironment(promise: Promise) {
    try {
      val core = JSONObject(Mobile.info())
      promise.resolve(JSONObject().put("platform", "android").put("nativeVersion", 1)
        .put("vpnAvailable", true).put("coreAvailable", core.getBoolean("ready")).put("core", core)
        .put("vpnPermission", if (VpnService.prepare(context) == null) "granted" else "required").toString())
    } catch (_: Exception) { promise.reject("NATIVE_OPERATION_FAILED", "NATIVE_OPERATION_FAILED") }
  }

  override fun getVpnState(promise: Promise) { promise.resolve(HafenVpnService.snapshot()) }
  // The iOS packet-flow diagnostic is only shown on iOS.
  override fun getVpnDiagnostics(promise: Promise) { promise.reject("VPN_DIAGNOSTICS_UNAVAILABLE", "VPN_DIAGNOSTICS_UNAVAILABLE") }
  override fun stopVpn(promise: Promise) { vpnRequests.incrementAndGet(); UiThreadUtil.runOnUiThread { HafenVpnService.stop(promise) } }
  override fun startVpn(profile: String, promise: Promise) = startProfile(profile, promise, vpnRequests.incrementAndGet())
  private fun startProfile(profile: String, promise: Promise, request: Long, connectionName: String = "手动节点") {
    UiThreadUtil.runOnUiThread {
      if (vpnRequests.get() != request) {
        promise.reject("TUNNEL_CANCELLED", "TUNNEL_CANCELLED")
      } else if (context.currentActivity == null || context.lifecycleState != com.facebook.react.common.LifecycleState.RESUMED) {
        promise.reject("ACTIVITY_UNAVAILABLE", "ACTIVITY_UNAVAILABLE")
      } else HafenVpnService.start(context, profile, promise, connectionName)
    }
  }

  override fun prepareVpn(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (pendingPermission != null) {
        promise.reject("OPERATION_IN_PROGRESS", "OPERATION_IN_PROGRESS")
        return@runOnUiThread
      }
      try {
        val intent = VpnService.prepare(context)
        if (intent == null) { promise.resolve(true); return@runOnUiThread }
        val activity = context.currentActivity
        if (activity == null) { promise.reject("ACTIVITY_UNAVAILABLE", "ACTIVITY_UNAVAILABLE"); return@runOnUiThread }
        pendingPermission = promise
        activity.startActivityForResult(intent, VPN_REQUEST)
      } catch (_: Exception) {
        pendingPermission = null
        promise.reject("NATIVE_OPERATION_FAILED", "NATIVE_OPERATION_FAILED")
      }
    }
  }

  private fun execute(promise: Promise, operation: () -> Any?) {
    try {
      worker.execute {
        try { promise.resolve(operation()) }
        catch (error: Exception) {
          val code = error.message?.takeIf { it in INPUT_ERRORS || it in SUBSCRIPTION_ERRORS } ?: "STORAGE_UNAVAILABLE"
          promise.reject(code, code)
        }
      }
    } catch (_: RejectedExecutionException) { promise.reject("NATIVE_UNAVAILABLE", "NATIVE_UNAVAILABLE") }
  }

  override fun getSelectedNode(promise: Promise) = execute(promise) { vault.selected() }
  override fun selectSubscriptionNode(id: String, revision: String, nodeId: String, promise: Promise) = execute(promise) { vault.select(id, revision, nodeId) }
  override fun listSubscriptions(promise: Promise) = execute(promise) { vault.list() }
  override fun saveSubscription(name: String, sourceUrl: String, promise: Promise) = execute(promise) { vault.save(name, sourceUrl) }
  override fun deleteSubscription(id: String, promise: Promise) = execute(promise) { vault.delete(id); null }

  override fun getNodeOrder(id: String, promise: Promise) = execute(promise) { vault.nodeOrder(id) }
  override fun setNodeOrder(id: String, order: String, promise: Promise) = execute(promise) { vault.setNodeOrder(id, order); null }
  override fun listSubscriptionNodes(id: String, promise: Promise) = execute(promise) { vault.nodes(id) }
  override fun refreshSubscription(id: String, promise: Promise) = execute(promise) { vault.update(id, null) }
  override fun importSubscription(id: String, content: String, promise: Promise) = execute(promise) { vault.update(id, content) }
  override fun startSubscriptionNode(id: String, revision: String, nodeId: String, promise: Promise) {
    val request = vpnRequests.incrementAndGet()
    try {
      worker.execute {
        try {
          val profile = vault.profile(id, revision, nodeId)
          val selection = JSONObject(vault.select(id, revision, nodeId))
          startProfile(profile, promise, request, selection.getString("name"))
        }
        catch (error: Exception) {
          val code = error.message?.takeIf { it in SUBSCRIPTION_ERRORS } ?: "STORAGE_UNAVAILABLE"
          promise.reject(code, code)
        }
      }
    } catch (_: RejectedExecutionException) { promise.reject("NATIVE_UNAVAILABLE", "NATIVE_UNAVAILABLE") }
  }

  override fun checkCoreProfile(profile: String, promise: Promise) = executeCore(promise) {
    Mobile.checkProfile(profile)
    null
  }

  override fun runCoreSelfTest(promise: Promise) = executeCore(promise) { Mobile.selfTest() }

  private fun executeCore(promise: Promise, operation: () -> Any?) {
    try {
      worker.execute {
        try { promise.resolve(operation()) }
        catch (error: Exception) {
          val code = error.message?.takeIf { it in CORE_ERRORS } ?: "CORE_SELF_TEST_FAILED"
          promise.reject(code, code)
        }
      }
    } catch (_: RejectedExecutionException) { promise.reject("NATIVE_UNAVAILABLE", "NATIVE_UNAVAILABLE") }
  }

  override fun onHostResume() = Unit
  override fun onHostPause() = Unit
  override fun onHostDestroy() {
    pendingPermission?.reject("ACTIVITY_UNAVAILABLE", "ACTIVITY_UNAVAILABLE")
    pendingPermission = null
  }

  override fun invalidate() {
    context.removeActivityEventListener(activityListener)
    context.removeLifecycleEventListener(this)
    UiThreadUtil.runOnUiThread { onHostDestroy() }
    worker.shutdown()
    super.invalidate()
  }

  companion object {
    const val NAME = "NativeHafenPlatform"
    private const val VPN_REQUEST = 24319
    private val SUBSCRIPTION_ERRORS = setOf("INVALID_SUBSCRIPTION", "INVALID_SUBSCRIPTION_CONTENT", "SUBSCRIPTION_DOWNLOAD_FAILED", "SUBSCRIPTION_TIMEOUT", "SUBSCRIPTION_HTTP_ERROR", "SUBSCRIPTION_TOO_LARGE", "SUBSCRIPTION_NODE_LIMIT", "SUBSCRIPTION_STORAGE_LIMIT", "NO_SUPPORTED_NODES", "STALE_SUBSCRIPTION", "INVALID_NODE", "NUMERIC_ENDPOINT_REQUIRED")
    private val INPUT_ERRORS = setOf("INVALID_NAME", "INVALID_URL", "HTTPS_REQUIRED", "URL_CREDENTIALS_NOT_ALLOWED", "URL_FRAGMENT_NOT_ALLOWED", "DUPLICATE_SUBSCRIPTION", "SUBSCRIPTION_LIMIT")
    private val CORE_ERRORS = setOf("INVALID_CORE_PROFILE", "UNSUPPORTED_CORE_PROTOCOL", "CORE_CONFIGURATION_FAILED", "CORE_CLOSE_FAILED", "CORE_SELF_TEST_FAILED", "OPERATION_IN_PROGRESS")
  }
}
