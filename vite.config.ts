import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { HttpsProxyAgent } from "https-proxy-agent";
function developmentProxy() {
  const configured = process.env.BANGUMI_HTTP_PROXY || process.env.HTTPS_PROXY;
  if (configured) return new HttpsProxyAgent(configured);
  if (process.platform !== "win32") return undefined;
  try {
    const address = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[System.Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]'https://next.bgm.tv').AbsoluteUri",
      ],
      { encoding: "utf8", timeout: 5000, windowsHide: true },
    ).trim();
    if (address && new URL(address).hostname !== "next.bgm.tv")
      return new HttpsProxyAgent(address);
  } catch {
    /* Direct networking is used if no system proxy is available. */
  }
  return undefined;
}
const communityProxy: Record<string, ProxyOptions> = {
  "/community-api": {
    target: "https://next.bgm.tv",
    changeOrigin: true,
    agent: developmentProxy(),
    rewrite: (path: string) => path.replace(/^\/community-api/, "/p1"),
    bypass: (request) => {
      delete request.headers.cookie;
      delete request.headers.authorization;
      return undefined;
    },
  },
};
const friendsProxy: Record<string, ProxyOptions> = {
  "/friends-api": {
    ...communityProxy["/community-api"],
    rewrite: (path) => path.replace(/^\/friends-api/, "/p1"),
    bypass: (request) => {
      delete request.headers.cookie;
      return undefined;
    },
  },
};
const updateProxy: Record<string, ProxyOptions> = {
  "/app-update/update.json": {
    target: "https://github.com",
    changeOrigin: true,
    followRedirects: true,
    agent: developmentProxy(),
    rewrite: () =>
      "/Wepdekr/bangumi-pocket/releases/latest/download/update.json",
    bypass: (request) => {
      delete request.headers.cookie;
      delete request.headers.authorization;
      return undefined;
    },
  },
};
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { ...communityProxy, ...friendsProxy, ...updateProxy },
    watch: {
      ignored: [
        "**/.toolchain/**",
        "**/android/**",
        "**/artifacts/**",
        "**/test-results/**",
      ],
    },
  },
  preview: { proxy: { ...communityProxy, ...friendsProxy, ...updateProxy } },
  build: { target: "es2020" },
});
