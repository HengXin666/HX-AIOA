package com.hengxin.aioa.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.Xml
import androidx.core.graphics.PathParser
import org.xmlpull.v1.XmlPullParser

// 自选图标的 SVG 光栅化 (#142): 只画基本图形 (path, circle, ellipse, rect, line, polyline, polygon, g 的继承与 transform),
// 脚本, 外链, foreignObject, image, use, 样式表一概不认, 所以上传的只有画好的 PNG, SVG 原文不出本机。
// 颜色只认 #rgb / #rrggbb / rgb() / 少数颜色名 / currentColor; 全是 currentColor 或黑色的算单色, 显示时跟主题着色。

private const val DEFAULT_VIEW = 24f
private const val MAX_ELEMENTS = 2000
private val SHAPES = setOf("path", "circle", "ellipse", "rect", "line", "polyline", "polygon")
// 这些元素整棵跳过 (含子元素)
private val SKIP = setOf("defs", "script", "style", "foreignObject", "image", "use", "mask", "clipPath", "pattern", "symbol", "metadata", "title", "desc")
private val NUMBERS = Regex("-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?")
private const val BLACK = 0xFF000000.toInt()
private const val CURRENT = "currentcolor"
private val NAMED = mapOf(
    "black" to BLACK, "white" to 0xFFFFFFFF.toInt(), "red" to 0xFFFF0000.toInt(), "green" to 0xFF008000.toInt(),
    "blue" to 0xFF0000FF.toInt(), "gray" to 0xFF808080.toInt(), "grey" to 0xFF808080.toInt(), "orange" to 0xFFFFA500.toInt(),
    "yellow" to 0xFFFFFF00.toInt(), "purple" to 0xFF800080.toInt(),
)

/** 解析一个颜色值: null 表示不画 (none / transparent); currentColor 与认不出的都当黑色。 */
internal fun svgColor(v: String): Int? {
    val s = v.trim().lowercase()
    if (s == "none" || s == "transparent") return null
    if (s == CURRENT) return BLACK
    NAMED[s]?.let { return it }
    if (s.startsWith("#")) {
        val h = s.drop(1)
        val full = when (h.length) {
            3 -> h.map { "$it$it" }.joinToString("")
            6 -> h
            else -> return BLACK
        }
        return full.toLongOrNull(16)?.let { (0xFF000000 or it).toInt() } ?: BLACK
    }
    if (s.startsWith("rgb(")) {
        val n = NUMBERS.findAll(s).map { it.value.toFloat().toInt().coerceIn(0, 255) }.toList()
        if (n.size >= 3) return (0xFF shl 24) or (n[0] shl 16) or (n[1] shl 8) or n[2]
    }
    return BLACK
}

/** 这个颜色在 "单色" 判断里算不算单色 (currentColor, 黑色, 不画)。 */
internal fun svgMono(v: String): Boolean {
    val s = v.trim().lowercase()
    return s == CURRENT || s == "none" || s == "transparent" || svgColor(s) == BLACK
}

/** transform 解析成 3x3 仿射矩阵的 6 个数 (a b c d e f); 认不出的部分忽略。 */
internal fun svgTransform(v: String): FloatArray {
    var m = floatArrayOf(1f, 0f, 0f, 1f, 0f, 0f)
    Regex("(matrix|translate|scale|rotate)\\s*\\(([^)]*)\\)").findAll(v).forEach { r ->
        val n = NUMBERS.findAll(r.groupValues[2]).map { it.value.toFloat() }.toList()
        val t = when (r.groupValues[1]) {
            "matrix" -> if (n.size == 6) n.toFloatArray() else null
            "translate" -> n.getOrNull(0)?.let { floatArrayOf(1f, 0f, 0f, 1f, it, n.getOrElse(1) { 0f }) }
            "scale" -> n.getOrNull(0)?.let { s -> floatArrayOf(s, 0f, 0f, n.getOrElse(1) { s }, 0f, 0f) }
            else -> n.getOrNull(0)?.let { deg ->
                val rad = Math.toRadians(deg.toDouble())
                val cos = Math.cos(rad).toFloat()
                val sin = Math.sin(rad).toFloat()
                val (cx, cy) = n.getOrElse(1) { 0f } to n.getOrElse(2) { 0f }
                floatArrayOf(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy)
            }
        }
        if (t != null) m = mul(m, t)
    }
    return m
}

private fun mul(a: FloatArray, b: FloatArray) = floatArrayOf(
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
)

/** viewBox (minX minY w h); 没有就用 width / height, 再没有按 24x24。 */
internal fun svgViewBox(viewBox: String?, width: String?, height: String?): FloatArray {
    val n = viewBox?.let { NUMBERS.findAll(it).map { m -> m.value.toFloat() }.toList() }
    if (n != null && n.size == 4 && n[2] > 0 && n[3] > 0) return n.toFloatArray()
    val w = width?.let { NUMBERS.find(it)?.value?.toFloat() }?.takeIf { it > 0 } ?: DEFAULT_VIEW
    val h = height?.let { NUMBERS.find(it)?.value?.toFloat() }?.takeIf { it > 0 } ?: DEFAULT_VIEW
    return floatArrayOf(0f, 0f, w, h)
}

/** 继承下来的画法。 */
private data class Style(val fill: String = "black", val stroke: String = "none", val width: Float = 1f, val cap: String = "butt", val join: String = "miter", val evenOdd: Boolean = false)

object SvgRaster {
    /** 画成 side x side 的透明底位图; 第二个值表示是否单色。解析失败抛异常。 */
    fun render(bytes: ByteArray, side: Int): Pair<Bitmap, Boolean> {
        val p = Xml.newPullParser()
        p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        p.setInput(bytes.inputStream(), null)
        val bmp = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        var mono = true
        var drawn = 0
        var count = 0
        val styles = ArrayDeque<Style>()
        var skipDepth = 0
        var started = false
        while (true) {
            val ev = p.next()
            if (ev == XmlPullParser.END_DOCUMENT) break
            if (ev == XmlPullParser.END_TAG) {
                if (skipDepth > 0) { skipDepth--; continue }
                if (styles.isNotEmpty()) { styles.removeLast(); canvas.restore() }
                continue
            }
            if (ev != XmlPullParser.START_TAG) continue
            require(++count <= MAX_ELEMENTS) { "SVG 太复杂" }
            val name = p.name.substringAfter(':')
            if (skipDepth > 0 || name in SKIP) { skipDepth++; continue }
            val attr = attrs(p)
            canvas.save()
            if (!started) {
                require(name == "svg") { "不是 SVG" }
                started = true
                val vb = svgViewBox(attr["viewBox"], attr["width"], attr["height"])
                val scale = minOf(side / vb[2], side / vb[3])
                canvas.translate((side - vb[2] * scale) / 2, (side - vb[3] * scale) / 2)
                canvas.scale(scale, scale)
                canvas.translate(-vb[0], -vb[1])
            }
            attr["transform"]?.let { t -> canvas.concat(Matrix().apply { setValues(svgTransform(t).let { m -> floatArrayOf(m[0], m[2], m[4], m[1], m[3], m[5], 0f, 0f, 1f) }) }) }
            val st = inherit(styles.lastOrNull() ?: Style(), attr)
            styles.addLast(st)
            if (name !in SHAPES) continue
            val path = shape(name, attr) ?: continue
            if (!svgMono(st.fill) || !svgMono(st.stroke)) mono = false
            path.fillType = if (st.evenOdd) Path.FillType.EVEN_ODD else Path.FillType.WINDING
            // 线段没有面积, 不填充
            (if (name == "line") null else svgColor(st.fill))?.let { color ->
                canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.FILL })
            }
            svgColor(st.stroke)?.let { color ->
                canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    this.color = color
                    style = Paint.Style.STROKE
                    strokeWidth = st.width
                    strokeCap = when (st.cap) { "round" -> Paint.Cap.ROUND; "square" -> Paint.Cap.SQUARE; else -> Paint.Cap.BUTT }
                    strokeJoin = when (st.join) { "round" -> Paint.Join.ROUND; "bevel" -> Paint.Join.BEVEL; else -> Paint.Join.MITER }
                })
            }
            drawn++
        }
        require(drawn > 0) { "SVG 里没有能画的图形" }
        return bmp to mono
    }

    /** 属性, 加上 style="fill:..;stroke:.." 里写的 (后者优先)。 */
    private fun attrs(p: XmlPullParser): Map<String, String> {
        val m = HashMap<String, String>()
        for (i in 0 until p.attributeCount) m[p.getAttributeName(i).substringAfter(':')] = p.getAttributeValue(i)
        m["style"]?.split(';')?.forEach { d ->
            val k = d.substringBefore(':').trim()
            val v = d.substringAfter(':', "").trim()
            if (k.isNotEmpty() && v.isNotEmpty()) m[k] = v
        }
        return m
    }

    private fun inherit(s: Style, a: Map<String, String>) = Style(
        fill = a["fill"] ?: s.fill,
        stroke = a["stroke"] ?: s.stroke,
        width = a["stroke-width"]?.let { NUMBERS.find(it)?.value?.toFloat() } ?: s.width,
        cap = a["stroke-linecap"] ?: s.cap,
        join = a["stroke-linejoin"] ?: s.join,
        evenOdd = a["fill-rule"]?.let { it == "evenodd" } ?: s.evenOdd,
    )

    private fun f(a: Map<String, String>, k: String): Float = a[k]?.let { NUMBERS.find(it)?.value?.toFloat() } ?: 0f

    private fun shape(name: String, a: Map<String, String>): Path? = when (name) {
        "path" -> a["d"]?.let { runCatching { PathParser.createPathFromPathData(it) }.getOrNull() }
        "circle" -> Path().apply { addCircle(f(a, "cx"), f(a, "cy"), f(a, "r"), Path.Direction.CW) }
        "ellipse" -> Path().apply { addOval(RectF(f(a, "cx") - f(a, "rx"), f(a, "cy") - f(a, "ry"), f(a, "cx") + f(a, "rx"), f(a, "cy") + f(a, "ry")), Path.Direction.CW) }
        "rect" -> Path().apply {
            val r = RectF(f(a, "x"), f(a, "y"), f(a, "x") + f(a, "width"), f(a, "y") + f(a, "height"))
            val rx = if (a.containsKey("rx")) f(a, "rx") else f(a, "ry")
            val ry = if (a.containsKey("ry")) f(a, "ry") else rx
            addRoundRect(r, rx, ry, Path.Direction.CW)
        }
        "line" -> Path().apply { moveTo(f(a, "x1"), f(a, "y1")); lineTo(f(a, "x2"), f(a, "y2")) }
        else -> a["points"]?.let { pts ->
            val n = NUMBERS.findAll(pts).map { it.value.toFloat() }.toList()
            if (n.size < 4) null else Path().apply {
                moveTo(n[0], n[1])
                for (i in 2 until n.size - 1 step 2) lineTo(n[i], n[i + 1])
                if (name == "polygon") close()
            }
        }
    }
}
