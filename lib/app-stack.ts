import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { VpcConstruct } from './constructs/vpc-construct';
import { AlbConstruct } from './constructs/alb-construct';
import { Ec2Construct } from './constructs/ec2-construct';
import { RdsConstruct } from './constructs/rds-construct';
import { MonitoringConstruct } from './constructs/monitoring-construct';

/**
 * 3層 Web アーキテクチャ スタック
 *
 * 構成:
 *   [Internet] → ALB (Public Subnet)
 *              → EC2 (Private Subnet) ← SSM Session Manager でログイン可
 *              → RDS MySQL (Isolated Subnet) ← EC2 からのみアクセス可
 *
 * Terraform の modules/ に相当する Construct を lib/constructs/ に配置し、
 * このスタックで組み合わせる（Terraform の main.tf に相当）。
 */
export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. ネットワーク層
    const network = new VpcConstruct(this, 'Network');

    // 2. フロントエンド層（ALB）
    const alb = new AlbConstruct(this, 'Alb', {
      vpc: network.vpc,
    });

    // 3. アプリ層（EC2）
    const webServer = new Ec2Construct(this, 'WebServer', {
      vpc: network.vpc,
      albSg: alb.albSg,
      targetGroup: alb.targetGroup,
    });

    // 4. データ層（RDS）
    const database = new RdsConstruct(this, 'Database', {
      vpc: network.vpc,
      ec2Sg: webServer.ec2Sg,
    });

    // 5. 監視層（CloudWatch Alarms + Dashboard）
    new MonitoringConstruct(this, 'Monitoring', {
      alb: alb.alb,
      targetGroup: alb.targetGroup,
      instance: webServer.instance,
      dbInstance: database.dbInstance,
    });

    cdk.Tags.of(this).add('Project', 'cdk-3tier-app');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // ── cdk-nag suppressions（dev 環境の意図的な省略） ────────────
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-VPC7',
        reason: 'dev 環境のため VPC Flow Logs は省略。本番では CloudWatch Logs への Flow Log を有効化すること。',
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'ALB の HTTP(80)/HTTPS(443) はインターネット公開が目的のため 0.0.0.0/0 を許可。意図的な設定。',
      },
      {
        id: 'AwsSolutions-ELB2',
        reason: 'dev 環境のため ALB アクセスログは省略。本番では S3 バケットへのアクセスログを有効化すること。',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AmazonSSMManagedInstanceCore は EC2 の SSM Session Manager 接続に必要な標準マネージドポリシー。',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMManagedInstanceCore'],
      },
      {
        id: 'AwsSolutions-EC26',
        reason: 'dev 環境のため EBS 暗号化は省略。本番では encrypted: true を設定すること。',
      },
      {
        id: 'AwsSolutions-EC28',
        reason: 'dev 環境のため EC2 詳細モニタリングは省略（追加コスト発生）。本番では detailedMonitoring: true を設定すること。',
      },
      {
        id: 'AwsSolutions-EC29',
        reason: 'dev 環境の単一 EC2 インスタンスのため終了保護は無効。本番では termination protection を有効化すること。',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason: 'dev 環境のため RDS マルチ AZ は無効（コスト削減）。本番では multiAz: true を設定すること。',
      },
      {
        id: 'AwsSolutions-RDS10',
        reason: 'dev 環境のため RDS 削除保護は無効。本番では deletionProtection: true を設定すること。',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'dev 環境のためデフォルトポート（3306）を使用。本番ではポート難読化を検討すること。',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason: 'dev 環境のため Secrets Manager の自動ローテーションは未設定。本番ではローテーション Lambda を設定すること。',
      },
    ]);
  }
}
