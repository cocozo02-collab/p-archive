import { defineConfig } from "vite";

export default defineConfig({
  // Capacitor WebView는 앱 내부 경로에서 파일을 읽으므로 상대 경로로 빌드한다.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
