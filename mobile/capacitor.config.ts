import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // 앱 ID는 지인에게 배포한 뒤에는 바꾸기 어렵다(바꾸면 다른 앱으로 설치된다).
  appId: "com.parchive.app",
  appName: "P-ARCHIVE",
  webDir: "dist",
  backgroundColor: "#0E1014",
  plugins: {
    // fetch/XHR을 네이티브 HTTP로 보낸다(CORS 없음). 쿠키는 CapacitorCookies가 관리한다. A2에서 동작 확인.
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
  },
};

export default config;
