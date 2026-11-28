package com.hengxin.aioa.ui

import androidx.compose.ui.graphics.Color
import com.hengxin.aioa.kit.MixStyle
import kotlin.test.Test
import kotlin.test.assertEquals

/** #144: 卡片折叠状态, fork / 自建标识, 单仓库混合图的左右轴分组。 */
class GithubFoldTest {
    @Test
    fun 折叠集合切换() {
        val a = foldToggle(emptySet(), FOLD_TREND, true)
        assertEquals(setOf(FOLD_TREND), a)
        assertEquals(setOf(FOLD_TREND, FOLD_HEAT), foldToggle(a, FOLD_HEAT, true))
        assertEquals(emptySet(), foldToggle(a, FOLD_TREND, false))
        assertEquals(a, foldToggle(a, FOLD_TREND, true))
    }

    @Test
    fun 仓库来源标识() {
        assertEquals("自建", repoOrigin(false, null))
        assertEquals("自建", repoOrigin(false, "x/y"))
        assertEquals("fork", repoOrigin(true, null))
        assertEquals("fork 自 pingdotgg/t3code", repoOrigin(true, "pingdotgg/t3code"))
    }

    @Test
    fun 单仓库混合图_PR与Issue左轴_提交右轴() {
        val pts = listOf(GhTrendPoint("2026-11-27", commits = 80, prOpened = 1, prMerged = 1, issueOpened = 2, issueClosed = 1), GhTrendPoint("2026-11-28", commits = 3))
        val s = repoTrendSeries(pts, Color.Red, Color.Green, Color.Blue, Color.Cyan, Color.Black)
        assertEquals(listOf("PR 新开", "PR 合入", "Issue 新开", "Issue 关闭"), s.left.map { it.label })
        assertEquals(listOf(MixStyle.LINE, MixStyle.BARS, MixStyle.DASHED, MixStyle.DOTS), s.left.map { it.style })
        assertEquals(1, s.right.size)
        assertEquals(listOf(80f, 3f), s.right[0].values)
        assertEquals(MixStyle.AREA, s.right[0].style)
        assertEquals("gh-trend-repo-a_b", repoTrendCache("a/b"))
    }
}
