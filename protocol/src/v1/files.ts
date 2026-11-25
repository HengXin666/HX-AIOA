// 文件: 字节放 R2 或 HX-CF-Drive (按主人的存储路由, 见下), 元数据放 Hub 的库; 消息里只带引用
// 上传两步: POST /files 登记拿到带票据的上传地址, 再把字节 PUT 过去 (由 Worker 直接写 R2, 不经过 DO)
// 下载: GET /files/{id}/link 换一条 24 小时内有效的地址, 由 Worker 直接从 R2 读; 客户端下载一次后本地永久缓存

export type FileRef = { id: string; name: string; size: number; mime: string };
export type FileCreateRequest = { name: string; size: number; mime?: string; channel?: string };
/**
 * 登记结果。没有 chunks 时把整个文件 PUT 到 upload; 有 chunks 时 (超过 95 MB, 只有 Drive 能收) 按 chunks.size 切片,
 * 第 i 片 PUT 到 `${upload}&i=<i>` (从 0 开始), 每片回一个 receipt, 全部传完后 POST /files/{id}/commit { receipts } (按序号排好)。
 */
export type FileChunks = { size: number; count: number };
export type FileCreated = { file: FileRef; upload: string; expires: number; chunks?: FileChunks };
export type FileChunkReceipt = { receipt: string };
export type FileCommitRequest = { receipts: string[] };
export type FileLink = { url: string; expires: number };
// 存储后端: r2 = 本部署的 R2 桶; cfd = HX-CF-Drive (字节在 TG 私有频道)
export const FILE_STORES = ["r2", "cfd"] as const;
export type FileStoreKind = (typeof FILE_STORES)[number];

/**
 * 存储路由, 只有主人能改 (设置里的 storage 键)。只影响之后上传的文件, 已有文件留在原后端,
 * 换地址时按文件自己记的后端解析, 消息里的 FileRef 不变。头像等 DO 里的数据不走这里。
 * - small / large: 不超过 / 超过 threshold 的文件走哪个后端; large 为 off 时拒收
 * - onFull: R2 到总量上限时, reject 拒收, cfd 新文件改走 Drive (主人显式选择)
 * - direct: 主人设备可以直连 TG 拉取 cfd 文件
 */
export type StorageSettings = {
  small: FileStoreKind;
  large: FileStoreKind | "off";
  threshold: number;
  onFull: "reject" | "cfd";
  direct: boolean;
};
export const SETTING_STORAGE = "storage";
export const FILE_BIG_THRESHOLD = 20 * 1024 * 1024;
export const FILE_THRESHOLD_MIN = 1024 * 1024;
// 不配时和接入 Drive 之前一样, 全部走 R2
export const STORAGE_DEFAULTS: StorageSettings = { small: "r2", large: "r2", threshold: FILE_BIG_THRESHOLD, onFull: "reject", direct: false };

export type StoreUsage = { bytes: number; count: number };
// 文件总用量: 字节数与个数, limit 为 R2 的总量上限 (只算 r2); byStore 分后端统计, ready 为该后端是否已绑定
export type FileUsage = {
  bytes: number;
  count: number;
  limit: number;
  byStore: Record<FileStoreKind, StoreUsage>;
  ready: Record<FileStoreKind, boolean>;
  storage: StorageSettings;
};

export const FILE_ID_PREFIX = "f_";
// Worker 免费计划单次请求体上限 100MB, 留出余量; 超过的只能分片传到 Drive
export const FILE_MAX_BYTES = 95 * 1024 * 1024;
// 分片上传 (只走 Drive) 的单文件上限; Drive 一片约 19 MB, 4 GB 约 216 片, 一次提交就能带全部回执
export const FILE_CHUNKED_MAX_BYTES = 4 * 1024 * 1024 * 1024;
// 分片上传的票据给 24 小时 (与 Drive 的上传票据一致), 慢网络也传得完
export const FILE_CHUNK_TTL_MS = 24 * 3600_000;
// R2 免费 10GB, 留 2GB 余量给别的桶
export const FILES_TOTAL_MAX_BYTES = 8 * 1024 * 1024 * 1024;
export const FILE_NAME_MAX = 200;
export const FILE_UPLOAD_TTL_MS = 3600_000;
export const FILE_LINK_TTL_MS = 24 * 3600_000;
export const FILE_QUERY_TICKET = "t";
export const FILE_QUERY_EXPIRES = "e";
export const FILE_DEFAULT_MIME = "application/octet-stream";
