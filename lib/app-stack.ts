import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
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
  }
}
