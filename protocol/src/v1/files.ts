// 文件: 字节放 R2, 元数据放 Hub 的库; 消息里只带引用
// 上传两步: POST /files 登记拿到带票据的上传地址, 再把字节 PUT 过去 (由 Worker 直接写 R2, 不经过 DO)
// 下载: GET /files/{id}/link 换一条 24 小时内有效的地址, 由 Worker 直接从 R2 读; 客户端下载一次后本地永久缓存

export type FileRef = { id: string; name: string; size: number; mime: string };
export type FileCreateRequest = { name: string; size: number; mime?: string; channel?: string };
export type FileCreated = { file: FileRef; upload: string; expires: number };
export type FileLink = { url: string; expires: number };
// 文件总用量: 字节数与个数, limit 为整个部署的上限
export type FileUsage = { bytes: number; count: number; limit: number };

export const FILE_ID_PREFIX = "f_";
// Worker 免费计划单次请求体上限 100MB, 留出余量
export const FILE_MAX_BYTES = 95 * 1024 * 1024;
// R2 免费 10GB, 留 2GB 余量给别的桶
export const FILES_TOTAL_MAX_BYTES = 8 * 1024 * 1024 * 1024;
export const FILE_NAME_MAX = 200;
export const FILE_UPLOAD_TTL_MS = 3600_000;
export const FILE_LINK_TTL_MS = 24 * 3600_000;
export const FILE_QUERY_TICKET = "t";
export const FILE_QUERY_EXPIRES = "e";
export const FILE_DEFAULT_MIME = "application/octet-stream";
