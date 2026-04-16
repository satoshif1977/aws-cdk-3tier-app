#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AppStack } from '../lib/app-stack';

const app = new cdk.App();

new AppStack(app, 'CdkAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
  description: 'AWS CDK 3-Tier Web App (VPC / ALB / EC2 / RDS)',
});

cdk.Tags.of(app).add('Environment', 'dev');
cdk.Tags.of(app).add('Project', 'cdk-3tier-app');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
