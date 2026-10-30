// 앱·곡 목록 업데이트. GitHub Releases에서 확인한다.
// - 앱: 태그 v<버전>(예: v0.6.0), 첨부 파일 p-archive.apk → 받아서 안드로이드 설치 화면을 띄운다.
// - 곡 목록: 태그 catalog-<YYYYMMDDHHmm>(UTC, 내보낸 시각), 첨부 파일 catalog.json → 받아서 앱 저장소에 두고 다음 실행부터 쓴다.

import { App } from "@capacitor/app";
import { CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { type CatalogFile, DOWNLOADED_CATALOG } from "./catalog";

/** 릴리스를 올리는 GitHub 저장소("계정/저장소"). */
export const GITHUB_REPO = "cocozo02-collab/p-archive";
export const APK_ASSET = "p-archive.apk";
export const CATALOG_ASSET = "catalog.json";

interface ApkInstallerPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { path: string }): Promise<void>;
}
const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body: string | null;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export interface AppUpdate {
  version: string;
  url: string;
  size: number;
  notes: string;
}

export interface CatalogUpdate {
  tag: string;
  url: string;
}

/** "0.10.1" > "0.9.3" 같은 버전 비교. a > b면 양수. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 카탈로그 내보낸 시각(ISO) → 릴리스 태그에 쓰는 형식(YYYYMMDDHHmm, UTC). */
export function catalogStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export function pickUpdates(releases: Release[], appVersion: string, catalogGeneratedAt: string)
  : { app: AppUpdate | null; catalog: CatalogUpdate | null } {
  const stable = releases.filter((r) => !r.draft && !r.prerelease);
  let app: AppUpdate | null = null;
  for (const r of stable.filter((r) => /^v\d/.test(r.tag_name))) {
    const asset = r.assets.find((a) => a.name === APK_ASSET);
    if (asset && compareVersions(r.tag_name, app?.version ?? appVersion) > 0) {
      app = { version: r.tag_name.replace(/^v/, ""), url: asset.browser_download_url, size: asset.size, notes: r.body ?? "" };
    }
  }
  let catalog: CatalogUpdate | null = null;
  const current = catalogStamp(catalogGeneratedAt);
  for (const r of stable.filter((r) => /^catalog-\d{12}$/.test(r.tag_name))) {
    const asset = r.assets.find((a) => a.name === CATALOG_ASSET);
    const stamp = r.tag_name.slice("catalog-".length);
    if (asset && stamp > (catalog?.tag.slice("catalog-".length) ?? current)) catalog = { tag: r.tag_name, url: asset.browser_download_url };
  }
  return { app, catalog };
}

export async function appVersion(): Promise<string> {
  try {
    return (await App.getInfo()).version;
  } catch {
    return "0.0.0";
  }
}

export async function checkUpdates(catalogGeneratedAt: string): Promise<{ app: AppUpdate | null; catalog: CatalogUpdate | null }> {
  if (GITHUB_REPO.startsWith("OWNER/")) return { app: null, catalog: null }; // 저장소가 아직 정해지지 않음
  const res = await CapacitorHttp.get({
    url: `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status !== 200) throw new Error(`업데이트 확인 실패 (GitHub ${res.status})`);
  const releases: Release[] = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return pickUpdates(releases, await appVersion(), catalogGeneratedAt);
}

/** 새 APK를 받아 설치 화면을 띄운다. 처음 한 번은 "이 앱에서 설치 허용" 설정이 필요하다. */
export async function installApp(update: AppUpdate, progress: (msg: string) => void): Promise<void> {
  const { allowed } = await ApkInstaller.canInstall();
  if (!allowed) {
    await ApkInstaller.openInstallSettings();
    throw new Error("설정에서 'P-ARCHIVE 앱에서 설치 허용'을 켠 뒤 다시 눌러 주세요");
  }
  progress(`새 버전 ${update.version} 받는 중… (${(update.size / 1024 / 1024).toFixed(1)} MB)`);
  // 캐시 폴더 바로 아래에 저장한다. 이 다운로드 함수는 recursive를 무시해서 하위 폴더를 만들어 주지 않는다
  // (하위 폴더 경로를 주면 "Error downloading file: … No such file or directory"로 실패한다).
  const result = await Filesystem.downloadFile({
    url: update.url, path: "p-archive-update.apk", directory: Directory.Cache,
  });
  if (!result.path) throw new Error("APK를 받지 못했습니다");
  await ApkInstaller.install({ path: result.path });
}

/** 새 곡 목록을 받아 앱 저장소에 둔다. 다음에 앱을 열 때부터 쓴다. */
export async function downloadCatalog(update: CatalogUpdate): Promise<CatalogFile> {
  const res = await CapacitorHttp.get({ url: update.url, responseType: "text" });
  if (res.status !== 200) throw new Error(`곡 목록을 받지 못했습니다 (${res.status})`);
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  const file: CatalogFile = JSON.parse(text);
  if (!Array.isArray(file.songs) || !Array.isArray(file.charts) || !file.generated_at) throw new Error("곡 목록 파일 형식이 맞지 않습니다");
  await Filesystem.writeFile({ path: DOWNLOADED_CATALOG, directory: Directory.Data, data: text, encoding: Encoding.UTF8, recursive: true });
  return file;
}
