package com.hengxin.aioa.ui

import kotlin.test.Test
import kotlin.test.assertEquals

/** #144: 卡片折叠状态, fork / 自建标识, 单仓库走势缓存名。 */
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
    fun 单仓库走势缓存名() {
        assertEquals("gh-trend-repo-a_b", repoTrendCache("a/b"))
    }
}
