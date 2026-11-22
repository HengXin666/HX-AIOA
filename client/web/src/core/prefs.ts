// 本地记住的 id 集合 (收藏, 已处理), 只存 id, 原始事件仍在服务端
export class IdSet {
  private set: Set<string>;

  constructor(private readonly key: string) {
    try {
      this.set = new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      this.set = new Set();
    }
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  toggle(id: string, on = !this.set.has(id)): void {
    if (on) this.set.add(id);
    else this.set.delete(id);
    localStorage.setItem(this.key, JSON.stringify([...this.set].slice(-500)));
  }
}
