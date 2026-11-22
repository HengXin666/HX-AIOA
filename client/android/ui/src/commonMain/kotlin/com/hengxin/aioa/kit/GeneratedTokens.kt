package com.hengxin.aioa.kit

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 由 tools/gen-tokens.mjs 生成, 请勿手改, 改 design/tokens.json。 */
object GeneratedTokens {
    val light = AioaColors(
        background = Color(0xFFFFFFFF),
        surface = Color(0xFFF4F4F4),
        surfaceAlt = Color(0xFFEAEAEA),
        border = Color(0xFFE5E5E5),
        text = Color(0xFF0D0D0D),
        textSecondary = Color(0xFF6B6B6B),
        accent = Color(0xFF0D0D0D),
        onAccent = Color(0xFFFFFFFF),
        success = Color(0xFF1A9F4B),
        warning = Color(0xFFE08600),
        danger = Color(0xFFD93025),
    )
    val dark = AioaColors(
        background = Color(0xFF212121),
        surface = Color(0xFF2F2F2F),
        surfaceAlt = Color(0xFF3A3A3A),
        border = Color(0xFF3D3D3D),
        text = Color(0xFFECECEC),
        textSecondary = Color(0xFF9B9B9B),
        accent = Color(0xFFECECEC),
        onAccent = Color(0xFF0D0D0D),
        success = Color(0xFF34C759),
        warning = Color(0xFFFF9F0A),
        danger = Color(0xFFFF453A),
    )
    val accentPresets = listOf(Color(0xFF0D0D0D), Color(0xFF2563EB), Color(0xFF10A37F), Color(0xFF7C3AED), Color(0xFFE11D48), Color(0xFFEA580C))
    object Radius {
        val sm = 8.dp
        val md = 16.dp
        val lg = 24.dp
        val pill = 999.dp
    }
    object Spacing {
        val xs = 4.dp
        val sm = 8.dp
        val md = 12.dp
        val lg = 16.dp
        val xl = 24.dp
    }
    object Blur {
        val sm = 8.dp
        val md = 16.dp
        val lg = 28.dp
    }
    object FontSize {
        val xs = 12.sp
        val sm = 13.sp
        val md = 15.sp
        val lg = 17.sp
        val xl = 22.sp
        val display = 32.sp
    }
    val standard = AioaMetrics(radius = Radius.md, gap = 12.dp, padding = 16.dp)
    val compact = AioaMetrics(radius = Radius.md, gap = 8.dp, padding = 12.dp)
}
