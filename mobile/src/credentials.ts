// "로그인 정보 기억"(선택, 기본 꺼짐). 켠 경우에만 안드로이드 Keystore 기반 보안 저장소에 저장한다.
// 꺼져 있으면 비밀번호는 로그인 요청에만 쓰고 버린다(세션 쿠키만 남는다).

import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const KEY = "piugame-login";

export interface Credentials {
  username: string;
  password: string;
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const v = await SecureStorage.get(KEY);
    return v && typeof v === "object" ? (v as unknown as Credentials) : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await SecureStorage.set(KEY, c as never);
}

export async function clearCredentials(): Promise<void> {
  try {
    await SecureStorage.remove(KEY);
  } catch {
    /* 저장된 값이 없으면 무시 */
  }
}
