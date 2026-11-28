package com.hengxin.aioa.ui.drive

import org.json.JSONArray
import org.json.JSONObject

// 网盘 (#154) 的纯数据与规则, 不碰安卓与网络, 单测见 DriveModelTest。接口见 docs/features/drive.md

internal const val SEP = "/"
private const val KIND_DIR = "dir"
private const val KB = 1024L

data class DriveNode(
    val id: String,
    val name: String,
    val dir: Boolean,
    val size: Long,
    val mime: String,
    val updatedAt: Long,
    // 搜索结果带完整路径; 列目录时为空
    val path: String = "",
    // 回收站里的删除时间
    val deletedAt: Long = 0,
)

data class DriveShare(val id: String, val name: String, val url: String, val expiresAt: Long?, val createdAt: Long, val hasPassword: Boolean)

data class DriveStats(val files: Long, val dirs: Long, val bytes: Long)

private fun JSONObject.str(k: String) = if (isNull(k)) "" else optString(k)

fun parseNode(o: JSONObject): DriveNode = DriveNode(
    o.optString("id"), o.optString("name"), o.optString("kind") == KIND_DIR, o.optLong("size"), o.str("mime"),
    o.optLong("updatedAt"), o.str("path"), o.optLong("deletedAt"),
)

fun parseNodes(a: JSONArray?): List<DriveNode> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::parseNode) }

fun parseShares(a: JSONArray?): List<DriveShare> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { i ->
    a.optJSONObject(i)?.let { o ->
        DriveShare(o.optString("id"), o.optString("name"), o.optString("url"), if (o.isNull("expiresAt")) null else o.optLong("expiresAt"), o.optLong("createdAt"), o.optBoolean("hasPassword"))
    }
}

/** 路径规则, 与 protocol normalizeDrivePath 一致: 以 / 开头, 不含 . .. 段。 */
object DrivePaths {
    fun normalize(raw: String): String = SEP + raw.split(SEP).filter { it.isNotEmpty() && it != "." && it != ".." }.joinToString(SEP)

    fun join(dir: String, name: String): String = if (dir == SEP) SEP + name else dir + SEP + name

    fun parent(path: String): String = path.substringBeforeLast(SEP, "").ifEmpty { SEP }

    fun nameOf(path: String): String = path.substringAfterLast(SEP)

    /** 面包屑: (显示名, 完整路径), 第一个是根 (显示名由调用方给)。 */
    fun crumbs(path: String, rootLabel: String): List<Pair<String, String>> {
        val parts = path.split(SEP).filter { it.isNotEmpty() }
        return listOf(rootLabel to SEP) + parts.mapIndexed { i, p -> p to SEP + parts.take(i + 1).joinToString(SEP) }
    }

    /** 新名字能不能用: 非空, 不含 / 与控制字符, 不是 . .. 。 */
    fun validName(name: String): Boolean =
        name.isNotBlank() && name == name.trim() && name.length <= NAME_MAX && !name.contains(SEP) && !name.contains('\\') && name != "." && name != ".." && name.none { it.code < 0x20 }

    private const val NAME_MAX = 255
}

enum class SortKey(val label: String) { NAME("名字"), SIZE("大小"), TIME("修改时间") }

data class DriveSort(val key: SortKey = SortKey.NAME, val desc: Boolean = false)

/** 文件夹在前, 再按所选的键排; 名字按不区分大小写的自然顺序 (2 在 10 前)。 */
fun sortNodes(items: List<DriveNode>, sort: DriveSort): List<DriveNode> {
    val byKey: Comparator<DriveNode> = when (sort.key) {
        SortKey.NAME -> Comparator { a, b -> naturalCompare(a.name, b.name) }
        SortKey.SIZE -> compareBy<DriveNode> { it.size }.thenComparator { a, b -> naturalCompare(a.name, b.name) }
        SortKey.TIME -> compareBy<DriveNode> { it.updatedAt }.thenComparator { a, b -> naturalCompare(a.name, b.name) }
    }
    val ordered = if (sort.desc) byKey.reversed() else byKey
    return items.sortedWith(compareBy<DriveNode> { !it.dir }.then(ordered))
}

private val DIGITS = Regex("\\d+|\\D+")

/** 自然顺序: 数字段按数值比, 其余按不区分大小写的字符比。 */
fun naturalCompare(a: String, b: String): Int {
    val x = DIGITS.findAll(a.lowercase()).map { it.value }.toList()
    val y = DIGITS.findAll(b.lowercase()).map { it.value }.toList()
    for (i in 0 until minOf(x.size, y.size)) {
        val p = x[i]
        val q = y[i]
        val c = if (p[0].isDigit() && q[0].isDigit()) compareValues(p.trimStart('0').length, q.trimStart('0').length).takeIf { it != 0 } ?: p.trimStart('0').compareTo(q.trimStart('0')) else p.compareTo(q)
        if (c != 0) return c
    }
    return compareValues(x.size, y.size).takeIf { it != 0 } ?: a.compareTo(b)
}

/** 字节数给人看: 1023 B, 1.5 KB, 12.3 MB, 1.20 GB。 */
fun sizeText(bytes: Long): String = when {
    bytes < KB -> "$bytes B"
    bytes < KB * KB -> "%.1f KB".format(bytes / KB.toDouble())
    bytes < KB * KB * KB -> "%.1f MB".format(bytes / (KB * KB).toDouble())
    else -> "%.2f GB".format(bytes / (KB * KB * KB).toDouble())
}

/** 预览方式 (#158): 点文件先进预览页, 不进下载目录; INFO 只显示信息卡。 */
enum class Preview { IMAGE, TEXT, PDF, AUDIO, VIDEO, INFO }

// 文本只读前 1 MB (Range), 图片与 PDF 太大就只给信息卡
internal const val TEXT_PREVIEW_MAX = KB * KB
private const val IMAGE_PREVIEW_MAX = 50L * KB * KB
private const val PDF_PREVIEW_MAX = 200L * KB * KB
private val TEXT_EXT = setOf(
    "txt", "md", "log", "json", "csv", "xml", "yml", "yaml", "ini", "conf", "kt", "kts", "java", "ts", "tsx", "js", "jsx", "py", "sh", "toml",
    "c", "h", "cpp", "hpp", "cc", "go", "rs", "rb", "php", "sql", "html", "css", "gradle", "properties", "env", "srt", "vtt",
)
private val IMAGE_EXT = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif")
private val VIDEO_EXT = setOf("mp4", "mkv", "webm", "mov", "3gp", "m4v", "ts")
private val AUDIO_EXT = setOf("mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "amr")
private val TEXT_MIME = setOf("application/json", "application/xml", "application/javascript", "application/x-sh", "application/toml", "application/yaml")

fun extOf(name: String): String = name.substringAfterLast('.', "").lowercase()

fun previewOf(n: DriveNode): Preview {
    val ext = extOf(n.name)
    val mime = n.mime.lowercase()
    return when {
        n.dir -> Preview.INFO
        mime.startsWith("image/") || ext in IMAGE_EXT -> if (n.size <= IMAGE_PREVIEW_MAX) Preview.IMAGE else Preview.INFO
        mime.startsWith("video/") || (ext in VIDEO_EXT && !mime.startsWith("text/")) -> Preview.VIDEO
        mime.startsWith("audio/") || ext in AUDIO_EXT -> Preview.AUDIO
        mime == "application/pdf" || ext == "pdf" -> if (n.size <= PDF_PREVIEW_MAX) Preview.PDF else Preview.INFO
        mime.startsWith("text/") || mime in TEXT_MIME || ext in TEXT_EXT -> Preview.TEXT
        else -> Preview.INFO
    }
}

/** 列表里的图标 (Lucide 名)。 */
fun iconOf(n: DriveNode): String = when {
    n.dir -> "folder"
    previewOf(n) == Preview.IMAGE -> "image"
    previewOf(n) == Preview.VIDEO -> "circle-play"
    previewOf(n) == Preview.AUDIO -> "mic"
    previewOf(n) == Preview.TEXT || previewOf(n) == Preview.PDF -> "file-text"
    n.mime.contains("zip") || n.mime.contains("compressed") -> "archive"
    else -> "file"
}

/** 分享有效期选项: (显示, 秒), 0 为永久。 */
val SHARE_TTLS = listOf("1 天" to 86_400L, "7 天" to 7 * 86_400L, "30 天" to 30 * 86_400L, "永久" to 0L)

/** 网盘页菜单 "关于网盘" 的说明 (#158), 页面上不再常驻长说明。 */
const val DRIVE_ABOUT = "网盘是独立的存储区, 和聊天附件, 邮件附件分开。聊天里 \"存到网盘\" 的文件在 \"聊天文件\" 里。"

/** Drive 的分段大小, 与 protocol 的 DRIVE_PART_SIZE 一致: 超过这么多片的上传按组 fold (#157)。 */
const val DRIVE_PART_SIZE = 256

/** 分片上传按组提交的规则 (#157): 第 g 组是 [g*256, g*256+256) 片, 最后一组可以不足。 */
object UploadParts {
    fun groups(count: Int): Int = (count + DRIVE_PART_SIZE - 1) / DRIVE_PART_SIZE

    fun range(g: Int, count: Int): IntRange = g * DRIVE_PART_SIZE until minOf(count, (g + 1) * DRIVE_PART_SIZE)

    /** 要不要 fold: 只有超过一组的文件才折叠。 */
    fun needed(count: Int): Boolean = count > DRIVE_PART_SIZE

    /** 第 g 组的回执是否齐了。 */
    fun full(g: Int, count: Int, has: (Int) -> Boolean): Boolean = range(g, count).all(has)

    /** 还要传的片: 跳过已折叠的组与已有回执的片。 */
    fun pending(count: Int, folded: (Int) -> Boolean, has: (Int) -> Boolean): List<Int> =
        (0 until count).filter { i -> !folded(i / DRIVE_PART_SIZE) && !has(i) }
}
