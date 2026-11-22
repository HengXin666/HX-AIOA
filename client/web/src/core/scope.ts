// 页面重绘时统一释放订阅和定时器, 避免泄漏
export class Scope {
  private fns: (() => void)[] = [];

  add(fn: () => void): void {
    this.fns.push(fn);
  }

  interval(fn: () => void, ms: number): void {
    const id = window.setInterval(fn, ms);
    this.add(() => window.clearInterval(id));
  }

  dispose(): void {
    this.fns.splice(0).forEach((fn) => fn());
  }
}
