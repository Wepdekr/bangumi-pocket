import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "tv.bgm.pocket",
  appName: "番组口袋",
  webDir: "dist",
  loggingBehavior: "none",
  android: { backgroundColor: "#F8F7F4" },
  plugins: { SystemBars: { insetsHandling: "css", style: "LIGHT" } },
};
export default config;
