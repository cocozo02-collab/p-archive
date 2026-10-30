import { Capacitor } from "@capacitor/core";

// A1: 빈 화면. 앱이 폰에서 뜨고, 네이티브 플랫폼으로 실행되는지만 확인한다.
const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <h1>P-ARCHIVE</h1>
  <p>플랫폼: ${Capacitor.getPlatform()} · 네이티브: ${Capacitor.isNativePlatform() ? "예" : "아니오"}</p>
`;
