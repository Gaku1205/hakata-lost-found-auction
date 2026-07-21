import * as cdk from 'aws-cdk-lib';
import { MeguriMonoStack } from '../lib/megurimono-stack';

const app = new cdk.App();

new MeguriMonoStack(app, 'MeguriMonoStack', {
  env: { region: 'ap-northeast-1' },
  description:
    'MeguriMono - regional lost-and-found auction demo (DynamoDB / Lambda / API Gateway / S3 / CloudFront)',
});
