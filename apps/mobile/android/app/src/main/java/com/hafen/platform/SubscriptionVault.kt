package com.hafen.platform

import com.hafen.core.mobile.Mobile
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Called exclusively on the module's serial executor. Never logs subscription data. */
internal class SubscriptionVault(context: Context) {
  private val file = AtomicFile(File(context.noBackupFilesDir, "subscriptions.v1.enc"))
  private val alias = "${context.packageName}.subscriptions.v1"
  private fun hasData() = file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    // A missing key with existing ciphertext is an error, never a request to reset data.
    if (hasData()) throw IllegalStateException("STORAGE_UNAVAILABLE")
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256).build())
      generateKey()
    }
  }

  private fun read(): JSONArray {
    if (!hasData()) return JSONArray()
    val bytes = file.readFully()
    require(bytes.size in 28..2_097_152)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    return JSONArray(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
  }

  private fun write(records: JSONArray) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    check(cipher.iv.size == 12)
    val bytes = cipher.iv + cipher.doFinal(records.toString().toByteArray(Charsets.UTF_8))
    if (bytes.size > 2_097_152) throw IllegalArgumentException("SUBSCRIPTION_STORAGE_LIMIT")
    val output = file.startWrite()
    try {
      output.write(bytes)
      file.finishWrite(output)
    } catch (error: Exception) {
      file.failWrite(output)
      throw error
    }
  }

  private fun metadata(record: JSONObject) = JSONObject()
    .put("id", record.getString("id"))
    .put("name", record.getString("name"))
    .put("host", URI(record.getString("sourceUrl")).host)
    .put("createdAtMs", record.getLong("createdAtMs"))

  fun list(): String {
    val records = read()
    val result = JSONArray()
    for (i in 0 until records.length()) result.put(metadata(records.getJSONObject(i)))
    return result.toString()
  }

  fun save(name: String, sourceUrl: String): String {
    val title = name.trim()
    val url = sourceUrl.trim()
    if (title.isEmpty() || title.length > 64 || title.any { it.code < 32 || it.code == 127 })
      throw IllegalArgumentException("INVALID_NAME")
    if (url.isEmpty() || url.length > 8192 || url.any { it.isWhitespace() || it == '\\' || it.code < 32 || it.code == 127 })
      throw IllegalArgumentException("INVALID_URL")
    val uri = try { URI(url) } catch (_: Exception) { throw IllegalArgumentException("INVALID_URL") }
    if (!uri.scheme.equals("https", ignoreCase = true)) throw IllegalArgumentException("HTTPS_REQUIRED")
    if (uri.host.isNullOrEmpty() || uri.port > 65535 || !url.startsWith("https://", ignoreCase = true)) throw IllegalArgumentException("INVALID_URL")
    if (uri.rawUserInfo != null) throw IllegalArgumentException("URL_CREDENTIALS_NOT_ALLOWED")
    if (uri.rawFragment != null) throw IllegalArgumentException("URL_FRAGMENT_NOT_ALLOWED")
    val records = read()
    for (i in 0 until records.length()) {
      if (records.getJSONObject(i).getString("sourceUrl") == url) throw IllegalArgumentException("DUPLICATE_SUBSCRIPTION")
    }
    if (records.length() >= 50) throw IllegalArgumentException("SUBSCRIPTION_LIMIT")
    val record = JSONObject().put("id", UUID.randomUUID().toString())
      .put("name", title).put("sourceUrl", url).put("createdAtMs", System.currentTimeMillis())
    records.put(record)
    write(records)
    return metadata(record).toString()
  }

  private fun record(records: JSONArray, id: String): JSONObject {
    try { UUID.fromString(id) } catch (_: Exception) { throw IllegalArgumentException("INVALID_SUBSCRIPTION") }
    for (i in 0 until records.length()) {
      val record = records.getJSONObject(i)
      if (record.getString("id") == id) return record
    }
    throw IllegalArgumentException("INVALID_SUBSCRIPTION")
  }

  fun nodeOrder(id: String): String = record(read(), id).optString("nodeOrder", "[]")

  fun setNodeOrder(id: String, order: String) {
    val records = read()
    record(records, id).put("nodeOrder", order)
    write(records)
  }

  fun nodes(id: String): String {
    val bundle = record(read(), id).optString("bundle", "")
    return if (bundle.isEmpty()) "null" else Mobile.subscriptionSummary(bundle)
  }

  fun update(id: String, content: String?): String {
    val records = read()
    val record = record(records, id)
    // Download/parse/check first. A failed update never mutates the last good bundle.
    val bundle = if (content == null) Mobile.fetchSubscription(record.getString("sourceUrl")) else Mobile.parseSubscription(content)
    val summary = Mobile.subscriptionSummary(bundle)
    record.put("bundle", bundle)
    record.optJSONObject("selection")?.let { selection ->
      val parsed = JSONObject(summary)
      val nodes = parsed.getJSONArray("nodes")
      val node = (0 until nodes.length()).map { nodes.getJSONObject(it) }
        .firstOrNull { it.getString("id") == selection.getString("nodeId") }
      if (node == null) record.remove("selection")
      else selection.put("revision", parsed.getString("revision")).put("name", node.getString("name"))
    }
    write(records)
    return summary
  }

  fun selected(): String {
    val records = read()
    for (i in 0 until records.length()) {
      records.getJSONObject(i).optJSONObject("selection")?.let { return it.toString() }
    }
    return "null"
  }

  fun select(id: String, revision: String, nodeId: String): String {
    val records = read()
    val record = record(records, id)
    val bundle = record.optString("bundle", "")
    if (bundle.isEmpty()) throw IllegalArgumentException("INVALID_NODE")
    Mobile.subscriptionProfile(bundle, revision, nodeId) // validates revision and support
    val nodes = JSONObject(Mobile.subscriptionSummary(bundle)).getJSONArray("nodes")
    val node = (0 until nodes.length()).map { nodes.getJSONObject(it) }.first { it.getString("id") == nodeId }
    val selection = JSONObject().put("subscriptionId", id).put("revision", revision)
      .put("nodeId", nodeId).put("name", node.getString("name"))
    for (i in 0 until records.length()) records.getJSONObject(i).remove("selection")
    record.put("selection", selection)
    write(records)
    return selection.toString()
  }

  fun profile(id: String, revision: String, nodeId: String): String {
    val bundle = record(read(), id).optString("bundle", "")
    if (bundle.isEmpty()) throw IllegalArgumentException("INVALID_NODE")
    return Mobile.subscriptionProfile(bundle, revision, nodeId)
  }

  fun delete(id: String) {
    UUID.fromString(id)
    val records = read()
    val next = JSONArray()
    for (i in 0 until records.length()) {
      val record = records.getJSONObject(i)
      if (record.getString("id") != id) next.put(record)
    }
    if (next.length() != records.length()) write(next)
  }
}
