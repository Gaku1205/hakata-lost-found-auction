// APIクライアントと認証Contextの橋渡し用トークン保持モジュール。
// Reactの外から参照できるよう module スコープで持つ。

let currentIdToken: string | null = null;

export const setCurrentIdToken = (token: string | null): void => {
  currentIdToken = token;
};

export const getCurrentIdToken = (): string | null => currentIdToken;
