package com.hengxin.aioa.update

import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.zip.InflaterInputStream

// 增量补丁格式 HXPATCH1, 由 tools/mkpatch.py 把 bsdiff 的 BSDIFF40 转换而来:
// 8 字节魔数, 3 个 8 字节小端长度 (ctrl, diff, extra 压缩后长度), 8 字节新文件大小, 之后是三段 zlib 数据
// 只用 java.util.zip, 不引入 bzip2 依赖; 旧文件随机读, 新文件顺序写, 内存占用很小
object BsPatch {
    private const val MAGIC = "HXPATCH1"
    private const val HEADER_SIZE = 40
    private const val BUF_SIZE = 64 * 1024

    fun apply(oldFile: File, patchFile: File, newFile: File) {
        val header = ByteArray(HEADER_SIZE)
        patchFile.inputStream().use { DataInputStream(it).readFully(header) }
        if (String(header, 0, MAGIC.length, Charsets.US_ASCII) != MAGIC) throw IOException("补丁魔数不对")
        val ctrlLen = readLong(header, 8)
        val diffLen = readLong(header, 16)
        val newSize = readLong(header, 32)
        val ctrl = section(patchFile, HEADER_SIZE.toLong())
        val diff = section(patchFile, HEADER_SIZE + ctrlLen)
        val extra = section(patchFile, HEADER_SIZE + ctrlLen + diffLen)
        RandomAccessFile(oldFile, "r").use { old ->
            BufferedOutputStream(newFile.outputStream(), BUF_SIZE).use { out ->
                run(old, DataInputStream(ctrl), DataInputStream(diff), DataInputStream(extra), out, newSize)
            }
        }
        ctrl.close()
        diff.close()
        extra.close()
    }

    private fun run(
        old: RandomAccessFile,
        ctrl: DataInputStream,
        diff: DataInputStream,
        extra: DataInputStream,
        out: BufferedOutputStream,
        newSize: Long,
    ) {
        val oldSize = old.length()
        val ctrlBuf = ByteArray(24)
        val buf = ByteArray(BUF_SIZE)
        val oldBuf = ByteArray(BUF_SIZE)
        var oldPos = 0L
        var newPos = 0L
        while (newPos < newSize) {
            ctrl.readFully(ctrlBuf)
            val addLen = readLong(ctrlBuf, 0)
            val copyLen = readLong(ctrlBuf, 8)
            val seek = readLong(ctrlBuf, 16)
            if (newPos + addLen + copyLen > newSize) throw IOException("补丁越界")
            var left = addLen
            while (left > 0) {
                val n = minOf(left, BUF_SIZE.toLong()).toInt()
                diff.readFully(buf, 0, n)
                readOld(old, oldSize, oldPos, oldBuf, n)
                for (i in 0 until n) buf[i] = (buf[i] + oldBuf[i]).toByte()
                out.write(buf, 0, n)
                oldPos += n
                left -= n
            }
            newPos += addLen
            left = copyLen
            while (left > 0) {
                val n = minOf(left, BUF_SIZE.toLong()).toInt()
                extra.readFully(buf, 0, n)
                out.write(buf, 0, n)
                left -= n
            }
            newPos += copyLen
            oldPos += seek
        }
    }

    // 超出旧文件范围的部分按 0 处理, 与 bspatch 行为一致
    private fun readOld(old: RandomAccessFile, oldSize: Long, pos: Long, dst: ByteArray, n: Int) {
        dst.fill(0, 0, n)
        val start = maxOf(pos, 0L)
        val end = minOf(pos + n, oldSize)
        if (start >= end) return
        old.seek(start)
        old.readFully(dst, (start - pos).toInt(), (end - start).toInt())
    }

    private fun section(file: File, offset: Long): InputStream {
        val input = file.inputStream()
        var skipped = 0L
        while (skipped < offset) skipped += input.skip(offset - skipped)
        return InflaterInputStream(input.buffered(BUF_SIZE))
    }

    // bsdiff 的 offtin: 小端, 最高位是符号位
    private fun readLong(b: ByteArray, off: Int): Long {
        var y = (b[off + 7].toLong() and 0x7f)
        for (i in 6 downTo 0) y = (y shl 8) or (b[off + i].toLong() and 0xff)
        return if (b[off + 7].toInt() and 0x80 != 0) -y else y
    }
}
