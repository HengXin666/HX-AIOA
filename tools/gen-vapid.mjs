// 生成一对 VAPID 密钥 (P-256), 打印 wrangler 命令; 只用 Node 自带 WebCrypto, 不加依赖
// 用法: node tools/gen-vapid.mjs [mailto:you@example.com]
const subject = process.argv[2] || "mailto:you@example.com";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log(`VAPID_SUBJECT=${subject}`);
console.log("\n# 在 server/ 下执行 (私钥只走 secret, 不要提交进仓库):");
console.log(`printf '%s' '${pub}' | npx wrangler secret put VAPID_PUBLIC_KEY`);
console.log(`printf '%s' '${d}' | npx wrangler secret put VAPID_PRIVATE_KEY`);
console.log(`printf '%s' '${subject}' | npx wrangler secret put VAPID_SUBJECT`);
console.log("\n# 或者配成仓库 secret / variable, 由部署流程同步, 见 docs/deploy/web/push.md");
console.log("# 换密钥后已有的浏览器订阅全部作废, 用户要在设置里重新打开推送");
