import { CognitoJwtVerifier } from 'aws-jwt-verify';

const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const CLIENT_ID = process.env.USER_POOL_CLIENT_ID ?? '';

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: CLIENT_ID,
});

export type AuthUser = {
  sub: string;
  nickname: string;
  email: string;
  isAdmin: boolean;
  isOrg: boolean;
  orgId?: string;
};

/**
 * Authorization ヘッダの IdToken を検証する。
 * 署名・有効期限・発行元 User Pool・クライアントIDを aws-jwt-verify が確認する。
 * 不正・未指定の場合は null。
 */
export const authenticate = async (
  authHeader: string | undefined,
): Promise<AuthUser | null> => {
  if (authHeader === undefined || authHeader === '') return null;
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const payload = await verifier.verify(token);
    const groups: unknown = payload['cognito:groups'];
    const nickname: unknown = payload['nickname'];
    const email: unknown = payload['email'];
    const orgId: unknown = payload['custom:orgId'];
    return {
      sub: payload.sub,
      nickname: typeof nickname === 'string' && nickname !== '' ? nickname : '利用者',
      email: typeof email === 'string' ? email : '',
      isAdmin: Array.isArray(groups) && groups.some((g) => g === 'admin'),
      isOrg: Array.isArray(groups) && groups.some((g) => g === 'org'),
      orgId: typeof orgId === 'string' && orgId !== '' ? orgId : undefined,
    };
  } catch {
    return null;
  }
};
