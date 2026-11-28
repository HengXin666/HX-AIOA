package com.hengxin.aioa.browser

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SiteRulesTest {
    @Test
    fun mergesToRegistrableDomain() {
        assertEquals("github.com", SiteRules.siteOf("gist.github.com"))
        assertEquals("github.com", SiteRules.siteOf("WWW.GitHub.com."))
        assertEquals("example.co.uk", SiteRules.siteOf("a.b.example.co.uk"))
        assertEquals("baidu.com", SiteRules.siteOf("passport.baidu.com"))
        // 公共后缀下的私有域名各算一个站
        assertEquals("alice.github.io", SiteRules.siteOf("alice.github.io"))
        assertEquals("localhost", SiteRules.siteOf("localhost"))
        assertEquals("192.168.1.2", SiteRules.siteOf("192.168.1.2"))
    }

    @Test
    fun loginLikeCookies() {
        assertTrue(SiteRules.looksLoggedIn(SiteRules.parse("_ga=1; user_session=abc")))
        assertTrue(SiteRules.looksLoggedIn(SiteRules.parse("BDUSS=xyz")))
        assertTrue(SiteRules.looksLoggedIn(SiteRules.parse("__Secure-next-auth.session-token=t")))
        assertFalse(SiteRules.looksLoggedIn(SiteRules.parse("_ga=1; _gid=2; csrftoken=x")))
        // GitHub 退出后会留 logged_in=no
        assertFalse(SiteRules.looksLoggedIn(SiteRules.parse("logged_in=no; _octo=GH1")))
        assertFalse(SiteRules.looksLoggedIn(SiteRules.parse("")))
    }

    @Test
    fun parseKeepsEmptyValues() {
        assertEquals(listOf("a" to "1", "b" to "", "c" to "x=y"), SiteRules.parse("a=1; b; c=x=y"))
    }

    @Test
    fun domainChainStopsAtSite() {
        assertEquals(listOf("a.b.example.com", "b.example.com", "example.com"), SiteRules.domainChain("a.b.example.com", "example.com"))
        assertEquals(listOf("other.org"), SiteRules.domainChain("other.org", "example.com"))
    }

    @Test
    fun expireLinesCoverParents() {
        val lines = SiteRules.expireLines("sid", listOf("a.example.com", "example.com"), true)
        assertEquals(3, lines.size)
        assertTrue(lines.all { it.startsWith("sid=;") && it.endsWith("; Secure") })
        assertTrue(lines[2].contains("Domain=.example.com"))
        assertEquals(1, SiteRules.expireLines("__Host-id", listOf("example.com"), true).size)
    }

    @Test
    fun arrangePinsCurrentAndSplitsGroups() {
        fun rec(site: String, last: Long, login: Boolean) = SiteRecord(site, site, setOf(site), "", 0, last, 1, login)
        val all = listOf(rec("a.com", 1, true), rec("b.com", 3, false), rec("c.com", 2, true), rec("d.com", 4, true))
        val g = SiteRules.arrange(all, "d.com", "")
        assertEquals(listOf("d.com"), g.current.map { it.site })
        assertEquals(listOf("c.com", "a.com"), g.login.map { it.site })
        assertEquals(listOf("b.com"), g.visited.map { it.site })
        assertEquals(listOf("b.com"), SiteRules.arrange(all, null, "B.c").visited.map { it.site })
    }

    @Test
    fun agoText() {
        assertEquals("刚刚", SiteRules.ago(0, 10_000))
        assertEquals("5 分钟前", SiteRules.ago(0, 5 * 60_000L))
        assertEquals("2 天前", SiteRules.ago(0, 2 * 86_400_000L))
    }
}
