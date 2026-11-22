package com.hengxin.aioa.ui.term

import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.ServerFrame

/** 一个终端窗口: 收会话就绪, 输出字节 (base64), 关闭原因。 */
interface TermSink {
    fun ready()
    fun data(b64: String)
    fun closed(reason: String?)
}

/** 终端会话路由: 按 sid 把服务端的帧分给打开的终端窗口; 断线时全部关掉 (服务端那边已失效)。 */
class TermHub(private val send: (String) -> Boolean) {
    private val sinks = mutableMapOf<String, TermSink>()

    fun open(sid: String, subject: String, ticket: String, cols: Int, rows: Int, sink: TermSink): Boolean {
        sinks[sid] = sink
        return send(Frames.termOpen(sid, subject, ticket, cols, rows))
    }

    fun input(sid: String, b64: String) {
        if (sid in sinks) send(Frames.term(sid, b64))
    }

    fun resize(sid: String, cols: Int, rows: Int) {
        if (sid in sinks) send(Frames.termResize(sid, cols, rows))
    }

    fun close(sid: String) {
        if (sinks.remove(sid) != null) send(Frames.termClose(sid))
    }

    fun onOffline() {
        val all = sinks.values.toList()
        sinks.clear()
        all.forEach { it.closed("连接断开") }
    }

    fun onFrame(frame: ServerFrame): Boolean = when (frame) {
        is ServerFrame.TermReady -> true.also { sinks[frame.sid]?.ready() }
        is ServerFrame.TermData -> true.also { sinks[frame.sid]?.data(frame.d) }
        is ServerFrame.TermClose -> true.also { sinks.remove(frame.sid)?.closed(frame.reason) }
        else -> false
    }
}
