import assert from "node:assert/strict";
import { test } from "node:test";

const { DriveFs } = await import("../src/drive/client");
const { migrateOld, sourcesOf, withStamp } = await import("../src/drive/migrate");

type Node = { id: string; name: string; kind: "dir" | "file"; parent: string | null };

/** 假 Drive 目录树 (令牌根视角): 支持 list, move (同名 409), delete。 */
function tree(nodes: Node[]) {
  let seq = 0;
  const byPath = (path: string): Node | undefined => {
    let cur = nodes.find((n) => n.parent === null);
    for (const seg of path.split("/").filter(Boolean)) cur = cur && nodes.find((n) => n.parent === cur!.id && n.name === seg);
    return cur;
  };
  const mkdirp = (path: string): Node => {
    let cur = nodes.find((n) => n.parent === null)!;
    for (const seg of path.split("/").filter(Boolean)) {
      let next = nodes.find((n) => n.parent === cur.id && n.name === seg);
      if (!next) nodes.push((next = { id: `d${++seq}`, name: seg, kind: "dir", parent: cur.id }));
      cur = next;
    }
    return cur;
  };
  const pathOf = (n: Node): string => (n.parent === null ? "" : `${pathOf(nodes.find((x) => x.id === n.parent)!)}/${n.name}`);
  const fetcher = {
    async fetch(req: Request): Promise<Response> {
      const u = new URL(req.url);
      const p = u.pathname.replace("/api/v1", "");
      const body = req.method === "POST" ? await req.json<Record<string, string>>() : {};
      if (p === "/fs/stat") return Response.json({ path: "/" });
      if (p === "/fs/list") {
        const d = byPath(u.searchParams.get("path")!);
        if (!d) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({ children: nodes.filter((n) => n.parent === d.id) });
      }
      if (p === "/fs/move") {
        const n = nodes.find((x) => x.id === body.id)!;
        const dst = mkdirp(body.toPath);
        const name = body.name ?? n.name;
        if (nodes.some((x) => x.parent === dst.id && x.name === name)) return Response.json({ error: "target exists" }, { status: 409 });
        Object.assign(n, { parent: dst.id, name });
        return Response.json({ node: n });
      }
      if (p === "/fs/delete") {
        const n = byPath(body.path)!;
        nodes.splice(nodes.indexOf(n), 1);
        return Response.json({ trashed: 1 });
      }
      return Response.json({ error: "?" }, { status: 400 });
    },
  };
  return { fetcher, paths: () => nodes.filter((n) => n.parent !== null).map(pathOf).sort() };
}

const fsOf = (fetcher: { fetch: (r: Request) => Promise<Response> }, tokenAbs: string, origin: string) => {
  const fs = new DriveFs(fetcher as unknown as Fetcher, origin, "t", false, false);
  fs.tokenAbs = tokenAbs;
  return fs;
};

test("迁移源: 根 /aioa 时令牌根下除月目录与网盘根都迁; 根 / 时只迁 /聊天文件 与 /aioa 下非月目录", () => {
  const [own] = sourcesOf("/aioa");
  assert.deepEqual([own.dir, own.pick("聊天文件"), own.pick("2026-11"), own.pick("drive")], ["/", true, false, false]);
  const [aioa, root] = sourcesOf("/");
  assert.deepEqual([aioa.dir, aioa.pick("备份"), aioa.pick("2026-11")], ["/aioa", true, false]);
  assert.deepEqual([root.dir, root.pick("聊天文件"), root.pick("照片")], ["/", true, false]);
});

test("根 /aioa: 旧的聊天文件与自建文件夹迁进 /drive, 同名合并, 月目录不动; 再跑一遍不再变化", async () => {
  const t = tree([
    { id: "R", name: "", kind: "dir", parent: null },
    { id: "m", name: "2026-11", kind: "dir", parent: "R" },
    { id: "m1", name: "f_1_a.png", kind: "file", parent: "m" },
    { id: "c", name: "聊天文件", kind: "dir", parent: "R" },
    { id: "c1", name: "a.txt", kind: "file", parent: "c" },
    { id: "c2", name: "b.txt", kind: "file", parent: "c" },
    { id: "u", name: "照片", kind: "dir", parent: "R" },
    { id: "D", name: "drive", kind: "dir", parent: "R" },
    { id: "Dc", name: "聊天文件", kind: "dir", parent: "D" },
    { id: "Dc1", name: "a.txt", kind: "file", parent: "Dc" },
  ]);
  const fs = fsOf(t.fetcher, "/aioa", "https://m1.example");
  assert.equal(await migrateOld(fs, 1_000), 3);
  const after = t.paths();
  assert.ok(after.includes("/2026-11/f_1_a.png"));
  assert.ok(after.includes("/drive/照片"));
  assert.ok(after.includes("/drive/聊天文件/b.txt"));
  assert.ok(after.some((p) => /^\/drive\/聊天文件\/a \(\d{14}\)\.txt$/.test(p)));
  assert.ok(!after.some((p) => p.startsWith("/聊天文件")));
  // 缓存内不再列目录; 过了缓存再跑也是 0
  assert.equal(await migrateOld(fs, 2_000), 0);
  assert.equal(await migrateOld(fs, 1_000 + 11 * 60_000), 0);
  assert.deepEqual(t.paths(), after);
});

test("根 /: Drive 根下主人自己的文件不动, 只迁 /聊天文件 与 /aioa 下的自建条目", async () => {
  const t = tree([
    { id: "R", name: "", kind: "dir", parent: null },
    { id: "own", name: "照片", kind: "dir", parent: "R" },
    { id: "c", name: "聊天文件", kind: "dir", parent: "R" },
    { id: "A", name: "aioa", kind: "dir", parent: "R" },
    { id: "Am", name: "2026-11", kind: "dir", parent: "A" },
    { id: "Ab", name: "备份", kind: "dir", parent: "A" },
  ]);
  assert.equal(await migrateOld(fsOf(t.fetcher, "/", "https://m2.example"), 1_000), 2);
  assert.deepEqual(t.paths(), ["/aioa", "/aioa/2026-11", "/drive", "/drive/备份", "/drive/聊天文件", "/照片"]);
});

test("重名后缀: 保留扩展名", () => {
  assert.equal(withStamp("a.txt", Date.UTC(2026, 10, 28, 1, 2, 3)), "a (20261128010203).txt");
  assert.equal(withStamp("README", Date.UTC(2026, 10, 28, 1, 2, 3)), "README (20261128010203)");
});
