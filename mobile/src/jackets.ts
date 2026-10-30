// 자켓 이미지: 저장소·릴리스에는 넣지 않고(저작권), 화면에 보이는 것만 piugame.com에서 받아 폰에 캐시한다.
// - 지연 로딩: 화면에 보이는(근처 200px 포함) 자켓만 받는다. 화면을 바꾸면 남은 대기열은 버린다.
// - 요청 간격: piugame 클라이언트의 앱 전체 1.5초 간격을 그대로 따른다.
// - 저장: 가운데를 정사각형으로 잘라 192px WebP로 줄여 Directory.Data/jackets/<키>.webp에 둔다.

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { PiuClient } from "./piu/client";

const DIR = "jackets";
const SIZE = 192;

const cached = new Map<string, string>(); // 캐시 키 → WebView에서 쓸 주소
const failed = new Set<string>(); // 이번 실행에서 실패한 키(계속 다시 시도하지 않는다)
const pending = new Map<string, string>(); // 받을 차례인 키 → 원본 주소(보이는 순서)
const client = new PiuClient();
let observer: IntersectionObserver | null = null;
let running = false;

/** 파일 이름으로 쓸 수 있는 키(곡 키 또는 piugame 해시)만 받는다. */
const safe = (key: string) => /^[0-9a-z]+$/i.test(key);

export async function initJackets(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true });
  } catch { /* 이미 있음 */ }
  try {
    const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
    for (const f of files) {
      if (f.name.endsWith(".webp")) cached.set(f.name.slice(0, -5), Capacitor.convertFileSrc(f.uri));
    }
  } catch { /* 캐시 없음 */ }
}

export function jacketSrc(key: string | null): string | null {
  return key ? cached.get(key) ?? null : null;
}

export function cachedCount(): number {
  return cached.size;
}

/** 새로 그린 화면의 자켓 자리([data-jk][data-src])를 지켜보다가 보이면 받는다. */
export function observeJackets(root: ParentNode): void {
  if (!("IntersectionObserver" in window)) return;
  observer ??= new IntersectionObserver(onIntersect, { rootMargin: "200px 0px" });
  observer.disconnect();
  pending.clear(); // 이전 화면에서 아직 못 받은 것은 버리고 지금 화면을 먼저 받는다
  for (const el of root.querySelectorAll<HTMLElement>("[data-jk][data-src]")) {
    const key = el.dataset.jk!;
    if (!cached.has(key) && !failed.has(key) && safe(key)) observer.observe(el);
  }
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    const el = e.target as HTMLElement;
    const key = el.dataset.jk!;
    if (cached.has(key)) {
      observer?.unobserve(el);
      continue;
    }
    if (e.isIntersecting) pending.set(key, el.dataset.src!);
    else pending.delete(key);
  }
  void pump();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [key, url] = pending.entries().next().value as [string, string];
      pending.delete(key);
      if (cached.has(key) || failed.has(key)) continue;
      try {
        const src = await download(key, url);
        cached.set(key, src);
        show(key, src);
      } catch {
        failed.add(key);
      }
    }
  } finally {
    running = false;
  }
}

async function download(key: string, url: string): Promise<string> {
  const bytes = await client.getBinary(url);
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bmp.close();
  const base64 = canvas.toDataURL("image/webp", 0.8).split(",")[1];
  const { uri } = await Filesystem.writeFile({ path: `${DIR}/${key}.webp`, directory: Directory.Data, data: base64 });
  return Capacitor.convertFileSrc(uri);
}

/** 받은 자켓을 지금 화면에 있는 같은 키의 자리에 모두 넣는다. */
function show(key: string, src: string): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-jk="${key}"]`)) {
    if (el.querySelector("img")) continue;
    const img = document.createElement("img");
    img.alt = "";
    img.src = src;
    el.appendChild(img);
    observer?.unobserve(el);
  }
}

export async function clearJackets(): Promise<void> {
  try {
    await Filesystem.rmdir({ path: DIR, directory: Directory.Data, recursive: true });
  } catch { /* 없음 */ }
  cached.clear();
  failed.clear();
  await initJackets();
}
