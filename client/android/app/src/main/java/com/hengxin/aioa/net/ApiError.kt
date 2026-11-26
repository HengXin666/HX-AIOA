package com.hengxin.aioa.net

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** 错误分类, 决定界面用什么图标, 颜色, 给不给重试 (#110)。 */
enum class ErrKind(val icon: String, val retry: Boolean) {
    TIMEOUT("clock", true),
    NETWORK("wifi-off", true),
    AUTH("key-round", false),
    DENIED("shield-off", false),
    INPUT("alert-triangle", false),
    SERVER("server", true),
    OTHER("alert-triangle", false);

    companion object {
        const val TIMEOUT_PREFIX = "超时: "
        const val NET_PREFIX = "网络不通: "
        private val AUTH_WORDS = listOf("未授权", "登录")
        private val DENIED_WORDS = listOf("无权", "权限", "只有主人", "仅主人")
        private val SERVER_WORDS = listOf("服务端出错", "内部错误", "(HTTP 5")

        fun of(code: Int): ErrKind = when {
            code == 401 -> AUTH
            code == 403 -> DENIED
            code == 408 || code == 504 || code == 524 -> TIMEOUT
            code in 400..499 -> INPUT
            code >= 500 -> SERVER
            else -> OTHER
        }

        /** 只剩文字的旧状态按我们自己拼的前缀与服务端常见措辞认; 认不出就是 OTHER。 */
        fun guess(text: String): ErrKind = when {
            text.startsWith(TIMEOUT_PREFIX) -> TIMEOUT
            text.startsWith(NET_PREFIX) -> NETWORK
            AUTH_WORDS.any { it in text } -> AUTH
            DENIED_WORDS.any { it in text } -> DENIED
            SERVER_WORDS.any { it in text } -> SERVER
            else -> OTHER
        }

        /** 网络异常转成给人看的一句话, 带上可识别的前缀。 */
        fun describe(e: Throwable): String = when (e) {
            is SocketTimeoutException, is InterruptedIOException -> "${TIMEOUT_PREFIX}服务端太久没响应, 检查网络或代理后重试"
            is UnknownHostException, is ConnectException -> "${NET_PREFIX}连不上服务端, 检查网络或代理"
            is IOException -> "${NET_PREFIX}${e.message ?: e.javaClass.simpleName}"
            else -> "网络错误: ${e.message ?: e.javaClass.simpleName}"
        }
    }
}
