package com.hengxin.aioa.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// 图表调色板 (#142): 对比度, 相邻可分, 热力单调; 另录一张明暗图表总图看效果

@OptIn(ExperimentalTestApi::class, ExperimentalRoborazziApi::class)
class ChartPaletteTest {
    private val both = listOf(tokensOf(Appearance(dark = false)), tokensOf(Appearance(dark = true)))

    @Test
    fun seriesHaveContrastOnBackgroundAndSurface() {
        for (t in both) {
            val p = chartPaletteOf(t.colors, t.dark)
            (p.series + p.success + p.warning).forEach { s ->
                listOf(t.colors.background, t.colors.surface).forEach { bg ->
                    assertTrue(contrastOf(s, bg) >= CHART_MIN_CONTRAST - 0.01f, "dark=${t.dark} $s on $bg = ${contrastOf(s, bg)}")
                }
            }
        }
    }

    @Test
    fun adjacentSeriesDiffer() {
        for (t in both) {
            val s = chartPaletteOf(t.colors, t.dark).series
            s.indices.forEach { i ->
                val a = s[i]
                val b = s[(i + 1) % s.size]
                val d = abs(a.red - b.red) + abs(a.green - b.green) + abs(a.blue - b.blue)
                assertTrue(d > 0.35f, "dark=${t.dark} series $i / ${i + 1} too close: $a $b")
            }
        }
    }

    @Test
    fun primaryIsNotInk() {
        // ink 皮肤的强调色是纯黑 / 纯白, 不能拿来当系列主色
        for (t in both) {
            val p = chartPaletteOf(t.colors, t.dark).primary
            assertTrue(maxOf(p.red, p.green, p.blue) - minOf(p.red, p.green, p.blue) > 0.2f, "primary $p is gray")
        }
    }

    @Test
    fun userAccentBecomesPrimary() {
        val t = tokensOf(Appearance(accent = ACCENT_CHOICES[2]))
        val p = chartPaletteOf(t.colors, t.dark).primary
        assertTrue(contrastOf(p, ACCENT_CHOICES[2]!!) < 1.3f)
    }

    @Test
    fun heatGetsDarkerOnLightAndBrighterOnDark() {
        for (t in both) {
            val h = chartPaletteOf(t.colors, t.dark).heat
            assertEquals(5, h.size)
            val l = h.drop(1).map { it.luminance() }
            val sorted = if (t.dark) l.sorted() else l.sortedDescending()
            assertEquals(sorted, l, "dark=${t.dark}")
        }
    }

    @Test
    fun niceCeilRounds() {
        assertEquals(1f, niceCeil(0.3f))
        assertEquals(4f, niceCeil(4f))
        assertEquals(15f, niceCeil(13f))
        assertEquals(15f, niceCeil(12f))
        assertEquals(100f, niceCeil(100f))
    }

    @Test
    fun shots() {
        for (dark in listOf(false, true)) {
            runDesktopComposeUiTest(390, 820) {
                setContent {
                    AioaTheme(Appearance(dark = dark)) {
                        val p = chartPalette()
                        Column(Modifier.fillMaxSize().background(Aioa.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                p.series.forEach { Box(Modifier.size(28.dp).background(it)) }
                                p.heat.forEach { Box(Modifier.size(14.dp).background(it)) }
                            }
                            Panel(Modifier.fillMaxWidth()) {
                                val me = ComboSeries("我", listOf(0f, 0f, 1f, 3f, 8f, 5f, 2f, 9f, 12f, 4f, 6f, 3f, 1f, 0f), p.primary, ComboKind.AREA)
                                val ag = ComboSeries("Agent", listOf(2f, 1f, 0f, 4f, 6f, 9f, 3f, 5f, 7f, 10f, 2f, 1f, 0f, 2f), p.accent)
                                val done = ComboSeries("完成待办", listOf(0f, 0f, 0f, 1f, 2f, 0f, 0f, 3f, 1f, 0f, 2f, 0f, 0f, 0f), p.success, ComboKind.BAR)
                                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                    ComboLegend(me, "54"); ComboLegend(ag, "52"); ComboLegend(done, "9")
                                }
                                ComboChart(List(24) { "${it.toString().padStart(2, '0')}:00" }, listOf(done, me, ag), Modifier.padding(start = 12.dp, end = 16.dp, bottom = 12.dp), marker = 8, markerColor = p.warning, ticks = listOf(0, 6, 12, 18, 23))
                            }
                            Heatmap(List(70) { (it * 7 % 5) }, 7, p.primary, Modifier.fillMaxWidth().height(90.dp), highlight = 69)
                            LineChart(List(20) { Point("$it", (it % 7).toFloat() * 3 + 10) }, "%", threshold = 28f, height = 120.dp)
                            RadialBars(List(24) { ((it * 5) % 11).toFloat() }, hxPalette().chart1, hxPalette().chart2, Modifier.size(150.dp), highlight = 23)
                        }
                    }
                }
                onRoot().captureRoboImage("build/outputs/roborazzi/chart_palette-${if (dark) "dark" else "light"}.png")
            }
        }
    }
}
