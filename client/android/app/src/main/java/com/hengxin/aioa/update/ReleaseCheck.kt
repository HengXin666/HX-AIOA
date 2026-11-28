package com.hengxin.aioa.update

import android.content.Context
import com.hengxin.aioa.net.Net
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

// 直接查 GitHub API, 不经过我们的服务端; 未认证限额 60 次/小时, 带 ETag 时 304 不计入限额
object ReleaseCheck {
    private const val LATEST_API = "https://api.github.com/repos/HengXin666/HX-AIOA/releases/latest"
    private const val HTTP_NOT_MODIFIED = 304
    private const val HEADER_ETAG = "ETag"

    /** 最新 release 的 versionCode; 标签不是 android-N 时返回 null。 */
    fun latest(context: Context): Long? {
        val saved = UpdatePrefs.load(context)
        val req = Request.Builder().url(LATEST_API)
            .header("Accept", "application/vnd.github+json")
            .apply { if (saved.etag.isNotEmpty() && saved.latestTag.isNotEmpty()) header("If-None-Match", saved.etag) }
            .build()
        Net.client(context).newCall(req).execute().use { resp ->
            if (resp.code == HTTP_NOT_MODIFIED) return UpdatePolicy.tagVersion(saved.latestTag)
            if (!resp.isSuccessful) throw IOException("GitHub 返回 ${resp.code}")
            val tag = JSONObject(resp.body!!.string()).optString("tag_name")
            val etag = resp.header(HEADER_ETAG).orEmpty()
            UpdatePrefs.edit(context) { it.copy(etag = etag, latestTag = tag) }
            return UpdatePolicy.tagVersion(tag)
        }
    }
}
