package com.hafen.platform

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import com.hafen.MainActivity
import com.hafen.core.mobile.Mobile
import com.hafen.core.mobile.PacketSession
import com.hafen.core.mobile.SocketProtector
import com.facebook.react.bridge.Promise
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Owns the TUN and core independently of the React Native UI lifecycle. */
class HafenVpnService : VpnService() {
  private val control = Executors.newSingleThreadExecutor()
  private var packets = Executors.newFixedThreadPool(2)
  private val running = AtomicBoolean(false)
  private val cleaned = AtomicBoolean(false)
  private var tunnel: ParcelFileDescriptor? = null
  private var core: PacketSession? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var physicalNetwork: Network? = null
  private val protectedSockets = java.util.concurrent.atomic.AtomicLong()
  private val failedProtection = java.util.concurrent.atomic.AtomicLong()

  override fun onCreate() {
    super.onCreate()
    synchronized(lock) { owner = this; launchPending = false; launchRequestId = null }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) { scheduleStop(null); return START_NOT_STICKY }
    if (intent?.action != START) { stopSelf(); return START_NOT_STICKY }
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "VPN 连接", NotificationManager.IMPORTANCE_LOW))
      val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
      val stop = PendingIntent.getService(this, 1, Intent(this, HafenVpnService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
      val notification = builder.setContentTitle("Hafen VPN")
        .setContentText("系统隧道运行中；可随时断开")
        .setSmallIcon(android.R.drawable.stat_sys_warning).setOngoing(true)
        .setContentIntent(open).addAction(Notification.Action.Builder(null, "断开", stop).build()).build()
      if (Build.VERSION.SDK_INT >= 34) startForeground(41, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
      else startForeground(41, notification)
      control.execute { startTunnel(intent.getStringExtra("requestId")) }
    } catch (_: Exception) { scheduleStop("TUNNEL_START_FAILED") }
    return START_NOT_STICKY // Never restart with missing/old credentials.
  }

  private fun startTunnel(requestId: String?) {
    val request = synchronized(lock) { pending?.takeIf { it.id == requestId } }
    if (running.get()) return
    if (request == null) {
      if (synchronized(lock) { pending == null }) closeTunnel(null)
      return
    }
    if (request.cancelled.get()) { closeTunnel(null); return }
    try {
      if (prepare(this) != null) throw IllegalStateException("VPN_PERMISSION_REQUIRED")
      val connectivity = getSystemService(ConnectivityManager::class.java)
      physicalNetwork = (listOfNotNull(connectivity.activeNetwork) + connectivity.allNetworks.toList()).distinct().firstOrNull {
        val capabilities = connectivity.getNetworkCapabilities(it)
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
          capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
      } ?: throw IllegalStateException("NETWORK_UNAVAILABLE")
      val interfaceName = connectivity.getLinkProperties(physicalNetwork!!)?.interfaceName
        ?: throw IllegalStateException("NETWORK_UNAVAILABLE")
      val interfaceIndex = java.net.NetworkInterface.getByName(interfaceName)?.index
        ?.takeIf { it > 0 } ?: throw IllegalStateException("NETWORK_UNAVAILABLE")
      core = Mobile.newPacketSession(request.profile, object : SocketProtector {
        override fun interfaceName(): String = interfaceName
        override fun interfaceIndex(): Int = interfaceIndex
        override fun protect(fd: Int): Boolean = try {
          if (!this@HafenVpnService.protect(fd)) { failedProtection.incrementAndGet(); false }
          else { ParcelFileDescriptor.fromFd(fd).use { physicalNetwork!!.bindSocket(it.fileDescriptor) }; protectedSockets.incrementAndGet(); true }
        } catch (_: Exception) { failedProtection.incrementAndGet(); false }
      })
      if (request.cancelled.get()) throw IllegalStateException("TUNNEL_CANCELLED")
      tunnel = Builder().setSession("Hafen").setMtu(1500).setBlocking(false)
        .addAddress("172.19.0.1", 30).addAddress("fdfe:dcba:9876::1", 126)
        .addDnsServer("172.19.0.2").addDnsServer("fdfe:dcba:9876::2")
        .addRoute("0.0.0.0", 0).addRoute("::", 0)
        .setUnderlyingNetworks(arrayOf(physicalNetwork!!)).establish()
        ?: throw IllegalStateException("VPN_PERMISSION_REQUIRED")
      if (request.cancelled.get()) throw IllegalStateException("TUNNEL_CANCELLED")
      val session = core!!; val fd = tunnel!!.fileDescriptor
      running.set(true)
      packets.execute {
        val poll = StructPollfd().apply { this.fd = fd; events = OsConstants.POLLIN.toShort() }
        val data = ByteArray(1500)
        try {
          while (running.get()) {
            if (Os.poll(arrayOf(poll), 250) <= 0) continue
            if (!running.get()) break
            val count = Os.read(fd, data, 0, data.size)
            if (count > 0) session.submitPacket(data.copyOf(count))
          }
        } catch (_: Exception) { if (running.get()) scheduleStop("TUNNEL_IO_FAILED") }
      }
      packets.execute {
        try {
          while (running.get()) {
            val data = session.nextPacket()
            if (!running.get()) break
            if (data != null && data.isNotEmpty()) Os.write(fd, data, 0, data.size)
          }
        } catch (_: Exception) { if (running.get()) scheduleStop("TUNNEL_IO_FAILED") }
      }
      val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) { if (network == physicalNetwork) scheduleStop("NETWORK_CHANGED") }
        override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
          if (network != physicalNetwork) return
          if (properties.interfaceName != interfaceName) { scheduleStop("NETWORK_CHANGED"); return }
          try { control.execute {
            if (running.get()) try { core?.refreshNetwork() } catch (error: Exception) {
              val code = if (error.message == "NETWORK_UNAVAILABLE") "NETWORK_UNAVAILABLE" else "NETWORK_CHANGED"
              scheduleStop(code)
            }
          } } catch (_: java.util.concurrent.RejectedExecutionException) { }
        }
      }
      networkCallback = callback
      connectivity.registerNetworkCallback(NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build(), callback)
      if (connectivity.getNetworkCapabilities(physicalNetwork!!) == null) throw IllegalStateException("NETWORK_CHANGED")
      synchronized(lock) {
        if (request.cancelled.get()) throw IllegalStateException("TUNNEL_CANCELLED")
        state = "connected"; lastError = null; pending = null
        request.profile = ""; request.promise.resolve(snapshot())
      }
    } catch (error: Exception) {
      val code = error.message?.takeIf { it in errors } ?: "TUNNEL_START_FAILED"
      closeTunnel(code)
    }
  }

  private fun scheduleStop(code: String?) {
    synchronized(lock) { pending?.cancelled?.set(true); if (state != "disconnected") state = "disconnecting" }
    try { control.execute { closeTunnel(code) } } catch (_: java.util.concurrent.RejectedExecutionException) { }
  }

  private fun closeTunnel(code: String?) {
    if (!cleaned.compareAndSet(false, true)) return
    running.set(false)
    networkCallback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
    networkCallback = null
    try { core?.networkLost(); core?.close() } catch (_: Exception) {}
    core = null
    packets.shutdown()
    try { packets.awaitTermination(2, TimeUnit.SECONDS) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    try { tunnel?.close() } catch (_: Exception) {}
    tunnel = null
    synchronized(lock) {
      state = "disconnected"; lastError = code
      pending?.let { it.profile = ""; it.promise.reject(code ?: "TUNNEL_CANCELLED", code ?: "TUNNEL_CANCELLED") }; pending = null
      stops.forEach { it.resolve(snapshot()) }; stops.clear()
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onRevoke() { scheduleStop("VPN_PERMISSION_REVOKED") }
  override fun onDestroy() {
    try { control.execute { closeTunnel(null); synchronized(lock) { if (owner === this) owner = null } } } catch (_: Exception) {}
    control.shutdown()
    super.onDestroy()
  }

  companion object {
    private const val START = "com.hafen.START_VPN"
    private const val STOP = "com.hafen.STOP_VPN"
    private const val CHANNEL = "hafen-vpn"
    private val lock = Any()
    private var owner: HafenVpnService? = null
    private var launchPending = false
    private var launchRequestId: String? = null
    private var state = "disconnected"
    private var lastError: String? = null
    private class Request(var profile: String, val promise: Promise, val cancelled: AtomicBoolean = AtomicBoolean(false), val id: String = java.util.UUID.randomUUID().toString())
    private var pending: Request? = null
    private val stops = mutableListOf<Promise>()
    private val errors = setOf("VPN_PERMISSION_REQUIRED", "NETWORK_UNAVAILABLE", "NETWORK_CHANGED", "TUNNEL_CANCELLED", "NUMERIC_ENDPOINT_REQUIRED", "INVALID_CORE_PROFILE", "UNSUPPORTED_CORE_PROTOCOL", "CORE_START_FAILED", "CORE_CONFIGURATION_FAILED")
    fun snapshot(): String = synchronized(lock) {
      JSONObject().put("state", state).put("error", lastError ?: JSONObject.NULL)
        .put("internetReachable", JSONObject.NULL)
        .put("diagnostics", JSONObject().put("protectedSockets", owner?.protectedSockets?.get() ?: 0)
          .put("failedProtection", owner?.failedProtection?.get() ?: 0)
          .put("packets", owner?.core?.stats()?.let { JSONObject(it) } ?: JSONObject.NULL)).toString()
    }
    fun start(context: Context, profile: String, promise: Promise) {
      synchronized(lock) {
        if (state != "disconnected" || owner != null || launchPending) { promise.reject("OPERATION_IN_PROGRESS", "OPERATION_IN_PROGRESS"); return }
        if (prepare(context) != null) { promise.reject("VPN_PERMISSION_REQUIRED", "VPN_PERMISSION_REQUIRED"); return }
        val request = Request(profile, promise); pending = request; state = "connecting"; lastError = null; launchPending = true; launchRequestId = request.id
        try {
          val intent = Intent(context, HafenVpnService::class.java).setAction(START).putExtra("requestId", request.id)
          if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
        catch (_: Exception) { launchRequestId = null; launchPending = false; pending = null; state = "disconnected"; request.profile = ""; promise.reject("TUNNEL_START_FAILED", "TUNNEL_START_FAILED"); return }
        Handler(Looper.getMainLooper()).postDelayed({
          synchronized(lock) {
            // A cancelled launch may never reach onCreate. Release only this
            // request's launch gate, never a subsequent request's gate.
            if (owner == null && launchRequestId == request.id) { launchPending = false; launchRequestId = null }
            if (pending === request) {
              request.cancelled.set(true)
              owner?.scheduleStop("TUNNEL_START_TIMEOUT")
              if (owner == null) { launchPending = false; pending = null; state = "disconnected"; request.profile = ""; promise.reject("TUNNEL_START_TIMEOUT", "TUNNEL_START_TIMEOUT") }
            }
          }
        }, 15000)
      }
    }
    fun stop(promise: Promise) {
      synchronized(lock) {
        if (state == "disconnected") { promise.resolve(snapshot()); return }
        pending?.cancelled?.set(true)
        val service = owner
        if (service == null) {
          pending?.let { it.profile = ""; it.promise.reject("TUNNEL_CANCELLED", "TUNNEL_CANCELLED") }; pending = null; state = "disconnected"
          promise.resolve(snapshot()); return
        }
        stops.add(promise); service.scheduleStop(null)
      }
    }
  }
}
