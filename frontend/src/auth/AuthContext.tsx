import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fetchConfig, type AuthConfig } from '../api';
import {
  AuthError,
  cognitoConfirmSignUp,
  cognitoRefresh,
  cognitoSignIn,
  cognitoSignUp,
} from './cognito';
import { setCurrentIdToken } from './tokenStore';

const STORAGE_KEY = 'megurimono-auth';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type AuthUserInfo = {
  sub: string;
  email: string;
  nickname: string;
  isAdmin: boolean;
  isOrg: boolean;
  orgId?: string;
};

export type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'authed'; user: AuthUserInfo };

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, nickname: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type StoredTokens = { idToken: string; refreshToken: string | null };

const loadTokens = (): StoredTokens | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as Record<string, unknown>).idToken === 'string'
    ) {
      const rec = data as Record<string, unknown>;
      return {
        idToken: rec.idToken as string,
        refreshToken: typeof rec.refreshToken === 'string' ? rec.refreshToken : null,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const saveTokens = (tokens: StoredTokens | null): void => {
  try {
    if (tokens === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    }
  } catch {
    // ストレージが使えない環境ではセッション内のみ有効
  }
};

type JwtPayload = Record<string, unknown>;

const parseJwtPayload = (token: string): JwtPayload | null => {
  const part = token.split('.')[1];
  if (part === undefined) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const utf8 = decodeURIComponent(
      Array.from(atob(b64), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const data: unknown = JSON.parse(utf8);
    return typeof data === 'object' && data !== null ? (data as JwtPayload) : null;
  } catch {
    return null;
  }
};

const extractUser = (payload: JwtPayload): AuthUserInfo | null => {
  const sub = payload['sub'];
  if (typeof sub !== 'string') return null;
  const nickname = payload['nickname'];
  const email = payload['email'];
  const groups = payload['cognito:groups'];
  const orgId = payload['custom:orgId'];
  return {
    sub,
    nickname: typeof nickname === 'string' && nickname !== '' ? nickname : '利用者',
    email: typeof email === 'string' ? email : '',
    isAdmin: Array.isArray(groups) && groups.some((g) => g === 'admin'),
    isOrg: Array.isArray(groups) && groups.some((g) => g === 'org'),
    orgId: typeof orgId === 'string' && orgId !== '' ? orgId : undefined,
  };
};

const tokenExpiryMs = (payload: JwtPayload): number => {
  const exp = payload['exp'];
  return typeof exp === 'number' ? exp * 1000 : 0;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const configRef = useRef<AuthConfig | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const ensureConfig = useCallback(async (): Promise<AuthConfig> => {
    if (configRef.current !== null) return configRef.current;
    const config = await fetchConfig();
    configRef.current = config;
    return config;
  }, []);

  const clearRefreshTimer = useCallback((): void => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const signOut = useCallback((): void => {
    clearRefreshTimer();
    saveTokens(null);
    setCurrentIdToken(null);
    setState({ status: 'anon' });
  }, [clearRefreshTimer]);

  const adoptToken = useCallback(
    (idToken: string, refreshToken: string | null): boolean => {
      const payload = parseJwtPayload(idToken);
      if (payload === null) return false;
      const user = extractUser(payload);
      if (user === null) return false;

      setCurrentIdToken(idToken);
      saveTokens({ idToken, refreshToken });
      setState({ status: 'authed', user });

      clearRefreshTimer();
      if (refreshToken !== null) {
        const delay = tokenExpiryMs(payload) - Date.now() - REFRESH_MARGIN_MS;
        if (delay > 0) {
          refreshTimerRef.current = window.setTimeout(() => {
            void (async () => {
              try {
                const config = await ensureConfig();
                const newIdToken = await cognitoRefresh(
                  config.region,
                  config.clientId,
                  refreshToken,
                );
                adoptToken(newIdToken, refreshToken);
              } catch {
                signOut();
              }
            })();
          }, delay);
        }
      }
      return true;
    },
    [clearRefreshTimer, ensureConfig, signOut],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = loadTokens();
      if (stored === null) {
        if (!cancelled) setState({ status: 'anon' });
        return;
      }
      const payload = parseJwtPayload(stored.idToken);
      const validUntil = payload === null ? 0 : tokenExpiryMs(payload);

      if (validUntil > Date.now() + 60_000) {
        if (!cancelled) adoptToken(stored.idToken, stored.refreshToken);
        return;
      }
      if (stored.refreshToken !== null) {
        try {
          const config = await ensureConfig();
          const newIdToken = await cognitoRefresh(
            config.region,
            config.clientId,
            stored.refreshToken,
          );
          if (!cancelled) adoptToken(newIdToken, stored.refreshToken);
          return;
        } catch {
          // リフレッシュ失敗時は未ログイン扱い
        }
      }
      saveTokens(null);
      setCurrentIdToken(null);
      if (!cancelled) setState({ status: 'anon' });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const config = await ensureConfig();
      const result = await cognitoSignIn(config.region, config.clientId, email, password);
      if (!adoptToken(result.idToken, result.refreshToken)) {
        throw new AuthError('トークンの解析に失敗しました', 'TokenParseError');
      }
    },
    [adoptToken, ensureConfig],
  );

  const signUp = useCallback(
    async (email: string, password: string, nickname: string): Promise<void> => {
      const config = await ensureConfig();
      await cognitoSignUp(config.region, config.clientId, email, password, nickname);
    },
    [ensureConfig],
  );

  const confirmSignUp = useCallback(
    async (email: string, code: string): Promise<void> => {
      const config = await ensureConfig();
      await cognitoConfirmSignUp(config.region, config.clientId, email, code);
    },
    [ensureConfig],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signUp, confirmSignUp, signOut }),
    [state, signIn, signUp, confirmSignUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
