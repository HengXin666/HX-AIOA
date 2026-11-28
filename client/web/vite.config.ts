import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

// 构建号: CI 用 GitHub 的运行号, 本地为 0; 页面靠 version.json 发现新部署
function buildInfo() {
  const web = Number(process.env.GITHUB_RUN_NUMBER ?? 0);
  let sha = process.env.GITHUB_SHA ?? "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse HEAD").toString().trim();
    } catch {
      sha = "dev";
    }
  }
  return { web, sha: sha.slice(0, 7) };
}

function versionFile(info: ReturnType<typeof buildInfo>): Plugin {
  return {
    name: "aioa-version",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(info) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env.VITE_AIOA_DEV_SERVER;
  const info = buildInfo();
  return {
    plugins: [react(), tailwind(), versionFile(info)],
    define: { __WEB_BUILD__: JSON.stringify(info) },
    build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 600 },
    // 连接共享用模块 SharedWorker (link-worker.ts)
    worker: { format: "es" },
    server: target ? { proxy: { "/api": { target, changeOrigin: true, ws: true } } } : undefined,
  };
});
