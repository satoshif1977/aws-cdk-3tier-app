import * as cdk from 'aws-cdk-lib/core';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

interface MonitoringConstructProps {
  alb: elbv2.ApplicationLoadBalancer;
  targetGroup: elbv2.ApplicationTargetGroup;
  instance: ec2.Instance;
  dbInstance: rds.DatabaseInstance;
}

/**
 * CloudWatch 監視 Construct
 *
 * 監視対象:
 *   - ALB: 5xx エラー率（閾値: 5%）
 *   - EC2: CPU 使用率（閾値: 80%）
 *   - RDS: CPU 使用率（閾値: 80%）
 */
export class MonitoringConstruct extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    // ── ALB アラーム ─────────────────────────────────────────
    // ALB 5xx エラー率: 5% 超で ALARM
    const alb5xxAlarm = new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
      alarmName: 'cdk-3tier-alb-5xx-rate',
      alarmDescription: 'ALB の 5xx エラー率が 5% を超えました',
      metric: new cloudwatch.MathExpression({
        expression: '(m1 / m2) * 100',
        usingMetrics: {
          m1: props.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
          m2: props.alb.metrics.requestCount({
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
        },
        period: cdk.Duration.minutes(5),
        label: 'ALB 5xx エラー率 (%)',
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ALB ヘルスチェック失敗数: 1台以上で ALARM
    const unhealthyHostAlarm = new cloudwatch.Alarm(this, 'UnhealthyHostAlarm', {
      alarmName: 'cdk-3tier-alb-unhealthy-hosts',
      alarmDescription: 'ALB ターゲットグループの非正常ホスト数が 1 以上になりました',
      metric: props.targetGroup.metrics.unhealthyHostCount({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ── EC2 アラーム ─────────────────────────────────────────
    // EC2 CPU 使用率: 80% 超で ALARM
    const ec2CpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: { InstanceId: props.instance.instanceId },
      period: cdk.Duration.minutes(5),
      statistic: 'Average',
      label: 'EC2 CPU 使用率 (%)',
    });
    const ec2CpuAlarm = new cloudwatch.Alarm(this, 'Ec2CpuAlarm', {
      alarmName: 'cdk-3tier-ec2-cpu-high',
      alarmDescription: 'EC2 の CPU 使用率が 80% を超えました',
      metric: ec2CpuMetric,
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
    });

    // ── RDS アラーム ─────────────────────────────────────────
    // RDS CPU 使用率: 80% 超で ALARM
    const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      alarmName: 'cdk-3tier-rds-cpu-high',
      alarmDescription: 'RDS の CPU 使用率が 80% を超えました',
      metric: props.dbInstance.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
    });

    // RDS 空き容量: 2GB 未満で ALARM
    const rdsFreeStorageAlarm = new cloudwatch.Alarm(this, 'RdsFreeStorageAlarm', {
      alarmName: 'cdk-3tier-rds-free-storage-low',
      alarmDescription: 'RDS の空きストレージが 2GB を下回りました',
      metric: props.dbInstance.metricFreeStorageSpace({
        period: cdk.Duration.minutes(5),
        statistic: 'Minimum',
      }),
      threshold: 2 * 1024 * 1024 * 1024, // 2GB（バイト換算）
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
    });

    // ── CloudWatch ダッシュボード ─────────────────────────────
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'cdk-3tier-app-dashboard',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'ALB - リクエスト数 / 5xx エラー',
            left: [
              props.alb.metrics.requestCount({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
            ],
            right: [
              props.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
              }),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'ALB - ターゲット応答時間',
            left: [
              props.alb.metrics.targetResponseTime({ period: cdk.Duration.minutes(5), statistic: 'Average' }),
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'EC2 - CPU 使用率',
            left: [ec2CpuMetric],
            leftAnnotations: [{ value: 80, label: '閾値 80%', color: '#ff6961' }],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'RDS - CPU 使用率 / 空きストレージ',
            left: [
              props.dbInstance.metricCPUUtilization({ period: cdk.Duration.minutes(5), statistic: 'Average' }),
            ],
            right: [
              props.dbInstance.metricFreeStorageSpace({ period: cdk.Duration.minutes(5), statistic: 'Minimum' }),
            ],
            leftAnnotations: [{ value: 80, label: '閾値 80%', color: '#ff6961' }],
            width: 12,
          }),
        ],
        [
          new cloudwatch.AlarmStatusWidget({
            title: 'アラーム一覧',
            alarms: [alb5xxAlarm, unhealthyHostAlarm, ec2CpuAlarm, rdsCpuAlarm, rdsFreeStorageAlarm],
            width: 24,
          }),
        ],
      ],
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://ap-northeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=cdk-3tier-app-dashboard`,
      description: 'CloudWatch ダッシュボード URL',
    });
  }
}
