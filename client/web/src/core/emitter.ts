// 最小的订阅器; 配合 useSyncExternalStore 用, 不引状态库
export class Emitter<T> {
  private readonly subs = new Set<(v: T) => void>();

  on(fn: (v: T) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(v: T): void {
    for (const fn of this.subs) fn(v);
  }
}
