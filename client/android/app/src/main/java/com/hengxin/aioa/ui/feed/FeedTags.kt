package com.hengxin.aioa.ui.feed

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import com.hengxin.aioa.kit.Aioa
import org.json.JSONArray
import org.json.JSONObject

/** 信息流标签, 与 protocol/src/v1/feed-tags.ts 一致; 顺序即优先级, desc 是给 Agent 的归类定义。 */
data class FeedTag(val id: String, val label: String, val desc: String, val color: String? = null) {
    fun json(): JSONObject = JSONObject().put("id", id).put("label", label).put("desc", desc).apply { color?.let { put("color", it) } }
}

const val TAG_OTHER = "other"
val FEED_COLORS = listOf("orange", "blue", "green", "red", "purple", "teal", "pink", "gray")
val DEFAULT_TAGS = listOf(
    FeedTag("deal", "福利", "能直接领到或省到钱的: 免费额度, 优惠, 兑换码, 抽奖, 公益站", "orange"),
    FeedTag("oss", "开源", "可以拿来用的开源项目, 工具, 脚本, 模型 (就算发在福利区也算这里)", "blue"),
    FeedTag("news", "资讯", "只用来了解的消息: 发布, 动态, 行业新闻, 政策", "green"),
    FeedTag(TAG_OTHER, "其他", "以上都不是", "gray"),
)
const val MAX_TAGS = 16
const val MAX_TAG_LABEL = 8
const val MAX_TAG_DESC = 120
val TAG_ID = Regex("^[a-z][a-z0-9-]{0,15}$")

/** 当前群的标签表, 信息流和推送卡都从这里取名字和颜色; ChatScreen 按群提供。 */
val LocalFeedTags = compositionLocalOf { DEFAULT_TAGS }

fun parseFeedTags(arr: JSONArray?): List<FeedTag> = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
    val o = arr?.optJSONObject(i) ?: return@mapNotNull null
    val id = o.optString("id").ifEmpty { return@mapNotNull null }
    FeedTag(id, o.optString("label").ifEmpty { id }, o.optString("desc"), o.optString("color").ifEmpty { null })
}

/** 没声明过的标签 (旧消息) 显示原 id, 中性色。 */
fun List<FeedTag>.labelOf(id: String): String = firstOrNull { it.id == id }?.label ?: id

@Composable
fun tagColor(name: String?): Color {
    val c = Aioa.colors
    val dark = Aioa.tokens.dark
    return when (name) {
        "orange" -> c.warning
        "blue" -> c.accent
        "green" -> c.success
        "red" -> c.danger
        "purple" -> if (dark) Color(0xFFBF8CFF) else Color(0xFF8E44D9)
        "teal" -> if (dark) Color(0xFF4FD1C5) else Color(0xFF0F9488)
        "pink" -> if (dark) Color(0xFFFF7EB6) else Color(0xFFD6336C)
        else -> c.textSecondary
    }
}

@Composable
fun kindColor(kind: String): Color = tagColor(LocalFeedTags.current.firstOrNull { it.id == kind }?.color)
