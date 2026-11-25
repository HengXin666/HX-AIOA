package com.hengxin.aioa.config

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * TG 直连用的 Bot 令牌, 只存在本机: Android Keystore 里的 AES 密钥加密后写进 App 私有目录, 不上传服务端。
 * 令牌在手机上等于这个 Bot 的全部权限 (能删频道消息), 手机丢了要在 BotFather 重置令牌并更新 Drive 后台。
 */
object TgBots {
    private const val FILE_NAME = "tg_bots.bin"
    private const val KEY_ALIAS = "aioa_tg_bots"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private val TOKEN_RE = Regex("^(\\d+):[\\w-]{20,}$")

    /** 令牌格式 `<bot_id>:<secret>`, 冒号前就是 Drive 分片清单里的 bot。 */
    fun valid(token: String): Boolean = TOKEN_RE.matches(token.trim())

    fun botId(token: String): String = token.substringBefore(':')

    /** bot id → 令牌; 没存或解不开 (换机, 清了 Keystore) 返回空。 */
    fun load(context: Context): Map<String, String> = runCatching {
        val raw = File(context.filesDir, FILE_NAME).takeIf { it.isFile }?.readBytes() ?: return emptyMap()
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, raw, 0, IV_BYTES))
        val arr = JSONArray(String(c.doFinal(raw, IV_BYTES, raw.size - IV_BYTES)))
        (0 until arr.length()).map { arr.getString(it) }.associateBy { botId(it) }
    }.getOrDefault(emptyMap())

    fun any(context: Context): Boolean = File(context.filesDir, FILE_NAME).isFile

    /** 保存一组令牌 (覆盖原来的); 空列表等于清除。格式不对的返回错误, 不保存。 */
    fun save(context: Context, tokens: List<String>): String? {
        val list = tokens.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        list.firstOrNull { !valid(it) }?.let { return "令牌格式不对: ${it.take(12)}..." }
        val file = File(context.filesDir, FILE_NAME)
        if (list.isEmpty()) {
            file.delete()
            return null
        }
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key())
        val body = c.doFinal(JSONArray(list).toString().toByteArray())
        file.writeBytes(c.iv + body)
        return null
    }

    /** 给界面显示的: 每个 Bot 的 id 与令牌末 4 位。 */
    fun summary(context: Context): List<String> = load(context).values.map { "${botId(it)} (…${it.takeLast(4)})" }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }
}
