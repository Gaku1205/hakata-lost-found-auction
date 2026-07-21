// Cognito の公開RESTエンドポイントを直接呼ぶ軽量クライアント。
// SDKを使わないことでバンドルサイズを抑えつつ、型は自前で厳密に定義する。

export class AuthError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const ERROR_MESSAGES: Record<string, string> = {
  NotAuthorizedException: 'メールアドレスまたはパスワードが違います',
  UserNotFoundException: 'メールアドレスまたはパスワードが違います',
  UsernameExistsException: 'このメールアドレスはすでに登録されています',
  InvalidPasswordException:
    'パスワードは8文字以上で、大文字・小文字・数字をそれぞれ含めてください',
  CodeMismatchException: '確認コードが違います',
  ExpiredCodeException: '確認コードの有効期限が切れています。再度お試しください',
  UserNotConfirmedException: 'メールアドレスの確認が完了していません',
  LimitExceededException: '試行回数が上限に達しました。しばらく待って再度お試しください',
  TooManyRequestsException: 'アクセスが集中しています。しばらく待って再度お試しください',
  InvalidParameterException: '入力内容を確認してください',
};

const translateError = (data: unknown): AuthError => {
  if (isRecord(data) && typeof data.__type === 'string') {
    const code = data.__type.split('#').pop() ?? data.__type;
    const message = ERROR_MESSAGES[code];
    if (message !== undefined) return new AuthError(message, code);
    if (typeof data.message === 'string') return new AuthError(data.message, code);
  }
  return new AuthError('認証処理に失敗しました。再度お試しください', 'Unknown');
};

const call = async (
  region: string,
  target: string,
  body: Record<string, unknown>,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('通信に失敗しました。接続を確認してください', 'NetworkError');
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw translateError(data);
  return data;
};

export type SignInResult = {
  idToken: string;
  refreshToken: string | null;
};

const parseAuthResult = (data: unknown): SignInResult => {
  if (isRecord(data) && isRecord(data.AuthenticationResult)) {
    const result = data.AuthenticationResult;
    if (typeof result.IdToken === 'string') {
      return {
        idToken: result.IdToken,
        refreshToken:
          typeof result.RefreshToken === 'string' ? result.RefreshToken : null,
      };
    }
  }
  throw new AuthError(
    'このアカウントは追加の確認が必要です。管理者にお問い合わせください',
    'ChallengeRequired',
  );
};

export const cognitoSignIn = async (
  region: string,
  clientId: string,
  email: string,
  password: string,
): Promise<SignInResult> => {
  const data = await call(region, 'InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return parseAuthResult(data);
};

export const cognitoRefresh = async (
  region: string,
  clientId: string,
  refreshToken: string,
): Promise<string> => {
  const data = await call(region, 'InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return parseAuthResult(data).idToken;
};

export const cognitoSignUp = async (
  region: string,
  clientId: string,
  email: string,
  password: string,
  nickname: string,
): Promise<void> => {
  await call(region, 'SignUp', {
    ClientId: clientId,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'nickname', Value: nickname },
    ],
  });
};

export const cognitoConfirmSignUp = async (
  region: string,
  clientId: string,
  email: string,
  code: string,
): Promise<void> => {
  await call(region, 'ConfirmSignUp', {
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
  });
};
