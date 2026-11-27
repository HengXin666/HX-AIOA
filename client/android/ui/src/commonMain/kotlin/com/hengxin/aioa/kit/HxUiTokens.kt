package com.hengxin.aioa.kit

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// 由 tools/hx-ui-gen.mjs 从 design/hx-ui/ (HX-UI 锁定版本) 生成, 请勿手改

/** HX-UI 的一套语义色 (与 shadcn 变量同名, 驼峰)。 */
@Immutable
data class HxPalette(
    val background: Color,
    val foreground: Color,
    val card: Color,
    val cardForeground: Color,
    val popover: Color,
    val popoverForeground: Color,
    val primary: Color,
    val primaryForeground: Color,
    val secondary: Color,
    val secondaryForeground: Color,
    val muted: Color,
    val mutedForeground: Color,
    val accent: Color,
    val accentForeground: Color,
    val destructive: Color,
    val success: Color,
    val warning: Color,
    val info: Color,
    val border: Color,
    val input: Color,
    val ring: Color,
    val brand: Color,
    val brandForeground: Color,
    val brandSoft: Color,
    val chart1: Color,
    val chart2: Color,
    val chart3: Color,
    val chart4: Color,
    val chart5: Color,
    val sidebar: Color,
    val sidebarForeground: Color,
    val sidebarPrimary: Color,
    val sidebarPrimaryForeground: Color,
    val sidebarAccent: Color,
    val sidebarAccentForeground: Color,
    val sidebarBorder: Color,
    val sidebarRing: Color,
)

/** HX-UI 2.3.0, 皮肤 ink。 */
object HxUi {
    const val VERSION = "2.3.0"
    const val SKIN = "ink"
    val light = HxPalette(
        background = Color(0xFFFFFFFF),
        foreground = Color(0xFF0D0D0D),
        card = Color(0xFFFFFFFF),
        cardForeground = Color(0xFF0D0D0D),
        popover = Color(0xFFF9F9F9),
        popoverForeground = Color(0xFF0D0D0D),
        primary = Color(0xFF0D0D0D),
        primaryForeground = Color(0xFFFFFFFF),
        secondary = Color(0xFFF4F4F4),
        secondaryForeground = Color(0xFF0D0D0D),
        muted = Color(0xFFF4F4F4),
        mutedForeground = Color(0xFF838286),
        accent = Color(0xFFECECEC),
        accentForeground = Color(0xFF0D0D0D),
        destructive = Color(0xFFDF2225),
        success = Color(0xFF16A356),
        warning = Color(0xFFF09C17),
        info = Color(0xFF1289E7),
        border = Color(0xFFE4E4E4),
        input = Color(0xFFE4E4E4),
        ring = Color(0xFFB4B4B4),
        brand = Color(0xFF0D0D0D),
        brandForeground = Color(0xFFFAFAFA),
        brandSoft = Color(0x140D0D0D),
        chart1 = Color(0xFF0D0D0D),
        chart2 = Color(0xFF00B9B2),
        chart3 = Color(0xFFE49E22),
        chart4 = Color(0xFFCF57C8),
        chart5 = Color(0xFF439458),
        sidebar = Color(0xFFF9F9F9),
        sidebarForeground = Color(0xFF0D0D0D),
        sidebarPrimary = Color(0xFF0D0D0D),
        sidebarPrimaryForeground = Color(0xFFFFFFFF),
        sidebarAccent = Color(0xFFECECEC),
        sidebarAccentForeground = Color(0xFF0D0D0D),
        sidebarBorder = Color(0xFFE4E4E4),
        sidebarRing = Color(0xFFB4B4B4),
    )
    val dark = HxPalette(
        background = Color(0xFF000000),
        foreground = Color(0xFFFFFFFF),
        card = Color(0xFF212121),
        cardForeground = Color(0xFFFFFFFF),
        popover = Color(0xFF212121),
        popoverForeground = Color(0xFFFFFFFF),
        primary = Color(0xFFFFFFFF),
        primaryForeground = Color(0xFF000000),
        secondary = Color(0xFF2B2B2B),
        secondaryForeground = Color(0xFFFFFFFF),
        muted = Color(0xFF212121),
        mutedForeground = Color(0xFFAFAFAF),
        accent = Color(0xFF2B2B2B),
        accentForeground = Color(0xFFFFFFFF),
        destructive = Color(0xFFFC5855),
        success = Color(0xFF42C070),
        warning = Color(0xFFF5AE39),
        info = Color(0xFF4BA3F7),
        border = Color(0xFF373737),
        input = Color(0xFF373737),
        ring = Color(0xFF4D4D4D),
        brand = Color(0xFFFFFFFF),
        brandForeground = Color(0xFF000000),
        brandSoft = Color(0x1AFFFFFF),
        chart1 = Color(0xFFFFFFFF),
        chart2 = Color(0xFF00B9B2),
        chart3 = Color(0xFFE49E22),
        chart4 = Color(0xFFCF57C8),
        chart5 = Color(0xFF439458),
        sidebar = Color(0xFF0D0D0D),
        sidebarForeground = Color(0xFFFFFFFF),
        sidebarPrimary = Color(0xFFFFFFFF),
        sidebarPrimaryForeground = Color(0xFF000000),
        sidebarAccent = Color(0xFF2B2B2B),
        sidebarAccentForeground = Color(0xFFFFFFFF),
        sidebarBorder = Color(0xFF373737),
        sidebarRing = Color(0xFF4D4D4D),
    )
    object Radius {
        val sm = 8.dp
        val md = 10.dp
        val lg = 12.dp
        val xl = 16.dp
        val X2xl = 22.dp
    }
    object Duration {
        const val fast = 150
        const val base = 250
        const val slow = 500
    }
    object Easing {
        val out = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
        val inOut = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)
        val spring = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
    }
}
