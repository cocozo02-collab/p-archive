// PC에서 내보낸 카탈로그(../export/catalog)를 앱 웹 자산(public/catalog)으로 복사한다.
// 카탈로그를 다시 내보냈으면 이 스크립트(npm run catalog) 후 APK를 다시 빌드한다.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../export/catalog", import.meta.url));
const dst = fileURLToPath(new URL("../public/catalog", import.meta.url));

if (!existsSync(`${src}/catalog.json`)) {
  console.error(`카탈로그가 없습니다: ${src}\nPC에서 먼저 실행: .venv\\Scripts\\python scripts\\export_catalog.py`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`카탈로그 복사: ${src} → ${dst}`);
