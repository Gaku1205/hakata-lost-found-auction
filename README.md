# めぐりモノ — 博多の遺失物オークション

警察・企業に届けられ、持ち主が見つからなかった落とし物を地域オークションで次の使い手へつなぐWebアプリのデモです。

## 主な機能

- 出品一覧・検索・入札・お気に入り・マイページ
- 出品元（商業施設）アカウントによる出品・売上確認・QRコードでの受け渡し
- 運営管理画面（出品・問い合わせ・出品元申し込みの管理、入札監視による吊り上げ検知）
- 出品画像からのAI自動入力（Amazon Bedrock / Claude）

## 技術スタック

| 領域 | 使用技術 |
| --- | --- |
| フロントエンド | React 18 / TypeScript / Vite / React Router |
| バックエンド | AWS Lambda / API Gateway / DynamoDB / S3 |
| 認証 | Amazon Cognito User Pool（Lambda側は aws-jwt-verify で検証） |
| 配信 | CloudFront |
| IaC | AWS CDK（TypeScript） |

## ディレクトリ構成

```
frontend/   React SPA
infra/      CDKスタック・Lambda・シードスクリプト
```

## セットアップ

前提: Node.js 20 以上、AWS CLI の認証設定、CDK のブートストラップ済みアカウント（リージョン ap-northeast-1）

```bash
cd frontend && npm ci && npm run build
cd ../infra && npm ci
npm test
npm run deploy
```

### デモデータの投入

デモアカウントのパスワードはリポジトリに含めていません。環境変数で指定してください。

```bash
SEED_DEMO_PASSWORD=... SEED_ADMIN_PASSWORD=... SEED_ORG_PASSWORD=... npm run seed
```

ログイン画面の「お試しログイン」ボタンは、フロントエンドのビルド時に `VITE_DEMO_PASSWORD` / `VITE_DEMO_ADMIN_PASSWORD` / `VITE_DEMO_ORG_PASSWORD` を指定した場合のみ表示されます。ビルド成果物に含まれるため、公開環境では管理者パスワードを指定しないでください。

### 商品画像について

商品画像（`frontend/public/images/`）は権利の都合でリポジトリに含めていません。画像がない出品はカテゴリアイコンで表示されます。
