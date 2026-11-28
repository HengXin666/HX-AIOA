import { ID_HEX, KEY_DB, KEY_DEVICE, KEY_STORE } from "./constants";

// 设备密钥: ECDSA P-256, 私钥不可导出, 整个 CryptoKey 存 IndexedDB (结构化克隆, 不出浏览器)
export type DeviceKey = { id: string; pub: JsonWebKey; priv: CryptoKey };

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
let cached: Promise<DeviceKey> | null = null;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(KEY_STORE, mode);
        const r = fn(t.objectStore(KEY_STORE));
        t.oncomplete = () => {
          d.close();
          resolve(r.result);
        };
        t.onerror = () => {
          d.close();
          reject(t.error);
        };
      }),
  );
}

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export function b64url(b: ArrayBuffer): string {
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 只取公钥的四个必需成员, 按 RFC 7638 的规范形式, 两端算出同一个 id
export const canonicalJwk = (k: JsonWebKey): JsonWebKey => ({ crv: k.crv, kty: k.kty, x: k.x, y: k.y });
export const sameKey = (a: JsonWebKey | undefined, b: JsonWebKey | undefined): boolean => Boolean(a && b && a.x === b.x && a.y === b.y && a.crv === b.crv);

export async function deviceIdOf(pub: JsonWebKey): Promise<string> {
  const c = canonicalJwk(pub);
  const json = JSON.stringify({ crv: c.crv, kty: c.kty, x: c.x, y: c.y });
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json))).slice(0, ID_HEX);
}

async function create(): Promise<DeviceKey> {
  const pair = await crypto.subtle.generateKey(ALG, false, ["sign", "verify"]);
  const pub = canonicalJwk(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const key: DeviceKey = { id: await deviceIdOf(pub), pub, priv: pair.privateKey };
  await tx("readwrite", (s) => s.put(key, KEY_DEVICE));
  return key;
}

export function deviceKey(): Promise<DeviceKey> {
  cached ??= tx<DeviceKey | undefined>("readonly", (s) => s.get(KEY_DEVICE) as IDBRequest<DeviceKey | undefined>)
    .then((k) => k ?? create())
    .catch((e: unknown) => {
      cached = null;
      throw e;
    });
  return cached;
}

// 签挑战: WebCrypto 原生输出就是 IEEE P1363 (r||s 64 字节)
export async function signNonce(nonce: string): Promise<string> {
  const k = await deviceKey();
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.priv, new TextEncoder().encode(nonce));
  return b64url(sig);
}
