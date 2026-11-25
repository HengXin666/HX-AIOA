import { COLD_DAYS_MAX, FILE_MAX_BYTES, FILE_STORES, FILE_THRESHOLD_MIN, type FileStoreKind, type Settings, SETTING_STORAGE, STORAGE_DEFAULTS, type StorageSettings } from "@hx-aioa/protocol";

const isStore = (v: unknown): v is FileStoreKind => typeof v === "string" && (FILE_STORES as readonly string[]).includes(v);

/** 设置里的存储路由, 缺的键取默认值 (默认与接入 Drive 之前一样全走 R2)。 */
export function storageOf(settings: Settings): StorageSettings {
  const v = settings[SETTING_STORAGE];
  return { ...STORAGE_DEFAULTS, ...(typeof v === "object" && v !== null ? (v as Partial<StorageSettings>) : {}) };
}

/**
 * 校验主人提交的存储路由 (可以只给要改的键), 返回合并后的完整配置或错误。
 * 选了没绑定的后端直接拒绝, 不保存一个用不了的配置, 也不在上传时悄悄换后端。
 */
export function checkStorage(raw: unknown, current: StorageSettings, ready: (k: FileStoreKind) => boolean): StorageSettings | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "storage 必须是对象";
  const next = { ...current, ...(raw as Partial<StorageSettings>) };
  for (const k of Object.keys(raw)) if (!(k in STORAGE_DEFAULTS)) return `storage.${k} 不认识`;
  if (!isStore(next.small)) return "storage.small 只能是 r2 或 cfd";
  if (!isStore(next.large) && next.large !== "off") return "storage.large 只能是 r2, cfd 或 off";
  if (!Number.isInteger(next.threshold) || next.threshold < FILE_THRESHOLD_MIN || next.threshold > FILE_MAX_BYTES) {
    return `storage.threshold 必须是 ${FILE_THRESHOLD_MIN} 到 ${FILE_MAX_BYTES} 之间的整数 (字节)`;
  }
  if (next.onFull !== "reject" && next.onFull !== "cfd") return "storage.onFull 只能是 reject 或 cfd";
  if (typeof next.direct !== "boolean") return "storage.direct 必须是布尔值";
  if (!Number.isInteger(next.coldDays) || next.coldDays < 0 || next.coldDays > COLD_DAYS_MAX) return `storage.coldDays 必须是 0 到 ${COLD_DAYS_MAX} 之间的整数 (天)`;
  const used = new Set<FileStoreKind>([next.small]);
  if (next.large !== "off") used.add(next.large);
  if (next.onFull === "cfd" || next.direct || next.coldDays > 0) used.add("cfd");
  for (const k of used) if (!ready(k)) return k === "r2" ? "服务端还没绑定 R2 文件桶, 不能选 r2" : "服务端还没接入 HX-CF-Drive, 不能选 cfd";
  return next;
}
