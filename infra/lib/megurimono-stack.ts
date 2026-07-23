import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import type { Construct } from 'constructs';

export const ITEMS_TABLE_NAME = 'megurimono-items';
export const BIDS_TABLE_NAME = 'megurimono-bids';
export const ORGANIZATIONS_TABLE_NAME = 'megurimono-organizations';
export const PARTNER_APPLICATIONS_TABLE_NAME = 'megurimono-partner-applications';

export class MeguriMonoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- データストア ----------
    const itemsTable = new dynamodb.Table(this, 'ItemsTable', {
      tableName: ITEMS_TABLE_NAME,
      partitionKey: { name: 'itemId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bidsTable = new dynamodb.Table(this, 'BidsTable', {
      tableName: BIDS_TABLE_NAME,
      partitionKey: { name: 'itemId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'bidId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 出品元（警察・自治体／企業）マスタ
    const organizationsTable = new dynamodb.Table(this, 'OrganizationsTable', {
      tableName: ORGANIZATIONS_TABLE_NAME,
      partitionKey: { name: 'orgId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 企業・自治体からの出品元申し込み
    const partnerApplicationsTable = new dynamodb.Table(this, 'PartnerApplicationsTable', {
      tableName: PARTNER_APPLICATIONS_TABLE_NAME,
      partitionKey: { name: 'applicationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- 認証（Cognito） ----------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'megurimono-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        nickname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: { userPassword: true },
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.hours(8),
      accessTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'admin',
      description: 'めぐりモノ 管理者（出品管理・受け渡し処理）',
    });

    // ---------- API（Lambda + API Gateway） ----------
    const apiFn = new lambdaNodejs.NodejsFunction(this, 'ApiFn', {
      entry: path.join(__dirname, '..', 'lambda', 'api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        ITEMS_TABLE: itemsTable.tableName,
        BIDS_TABLE: bidsTable.tableName,
        ORGANIZATIONS_TABLE: organizationsTable.tableName,
        PARTNER_APPLICATIONS_TABLE: partnerApplicationsTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      bundling: {
        minify: true,
        target: 'node20',
      },
    });
    itemsTable.grantReadWriteData(apiFn);
    bidsTable.grantReadWriteData(apiFn);
    organizationsTable.grantReadWriteData(apiFn);
    partnerApplicationsTable.grantReadWriteData(apiFn);

    // ---------- オークション自動終了（EventBridge） ----------
    // 終了時刻を過ぎ、入札がついた出品を毎分スキャンして自動的に落札確定する。
    // API Gateway を経由せず、同じLambdaコード内の別ハンドラを直接起動する。
    const autoCloseFn = new lambdaNodejs.NodejsFunction(this, 'AutoCloseFn', {
      entry: path.join(__dirname, '..', 'lambda', 'api.ts'),
      handler: 'autoCloseHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ITEMS_TABLE: itemsTable.tableName,
        BIDS_TABLE: bidsTable.tableName,
        ORGANIZATIONS_TABLE: organizationsTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      bundling: {
        minify: true,
        target: 'node20',
      },
    });
    itemsTable.grantReadWriteData(autoCloseFn);
    bidsTable.grantReadData(autoCloseFn);

    new events.Rule(this, 'AutoCloseRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(autoCloseFn)],
    });

    const api = new apigateway.LambdaRestApi(this, 'Api', {
      handler: apiFn,
      proxy: true,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: 'prod',
        // 乱用対策のスロットリング
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
    });

    // ---------- 可観測性（CloudWatch） ----------
    // 通知先（SNS等）は未接続。異常時に手動でコンソールを確認する運用を想定。
    const alarmDefaults = {
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    };

    new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
      alarmDescription: 'ApiFn（メインAPI）でエラーが発生しています',
      metric: apiFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      ...alarmDefaults,
    });

    new cloudwatch.Alarm(this, 'ApiThrottlesAlarm', {
      alarmDescription: 'ApiFn がスロットリングされています',
      metric: apiFn.metricThrottles({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      ...alarmDefaults,
    });

    new cloudwatch.Alarm(this, 'AutoCloseErrorsAlarm', {
      alarmDescription: 'AutoCloseFn（オークション自動終了）でエラーが発生しています',
      metric: autoCloseFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      ...alarmDefaults,
    });

    new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      alarmDescription: 'API Gateway で5xxエラーが発生しています',
      metric: api.metricServerError({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      ...alarmDefaults,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'OpsDashboard', {
      dashboardName: 'MeguriMono-Ops',
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ApiFn 呼び出し数／エラー数',
        left: [apiFn.metricInvocations({ period: cdk.Duration.minutes(5) })],
        right: [apiFn.metricErrors({ period: cdk.Duration.minutes(5) })],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ApiFn レイテンシ（p50 / p99）',
        left: [
          apiFn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p50' }),
          apiFn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p99' }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway 4xx / 5xx',
        left: [api.metricClientError({ period: cdk.Duration.minutes(5) })],
        right: [api.metricServerError({ period: cdk.Duration.minutes(5) })],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'AutoCloseFn 呼び出し数／エラー数（1分間隔）',
        left: [autoCloseFn.metricInvocations({ period: cdk.Duration.minutes(5) })],
        right: [autoCloseFn.metricErrors({ period: cdk.Duration.minutes(5) })],
        width: 12,
      }),
    );

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
    });

    // ---------- フロントエンド配信（S3 + CloudFront） ----------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------- 商品画像（管理者アップロード用） ----------
    // siteBucket とは分離: BucketDeployment はデフォルトで prune するため、
    // 同居させるとフロントエンド再デプロイ時にアップロード画像が消えてしまう。
    const imagesBucket = new s3.Bucket(this, 'ImagesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });
    imagesBucket.grantPut(apiFn);
    apiFn.addEnvironment('IMAGES_BUCKET', imagesBucket.bucketName);

    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'MeguriMono security headers',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: {
          contentSecurityPolicy: csp,
          override: true,
        },
      },
    });

    // SPA fallback: 拡張子を持たないパス（/items/xxx 等）を index.html に書き換える。
    // errorResponses(403→index.html) 方式だと /api/* の 403(権限エラー) まで
    // HTML にすり替わるため、既定ビヘイビア限定の CloudFront Function を使う。
    const spaRewriteFn = new cloudfront.Function(this, 'SpaRewriteFn', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (!request.uri.includes('.')) {
    request.uri = '/index.html';
  }
  return request;
}
`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'MeguriMono demo site',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [
          {
            function: spaRewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // 静的デモ画像（frontend/public 経由で siteBucket に同梱）は既定ビヘイビアの
        // /images/* が担当するため、管理者アップロード画像は別パスに分離する。
        '/uploads/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(imagesBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'frontend', 'dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.domainName}` });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'ApiDirectUrl', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }
}
