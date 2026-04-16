import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

interface AlbConstructProps {
  vpc: ec2.Vpc;
}

export class AlbConstruct extends Construct {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albSg: ec2.SecurityGroup;
  public readonly listener: elbv2.ApplicationListener;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: AlbConstructProps) {
    super(scope, id);

    // ALB 用セキュリティグループ（HTTP:80 をインターネットから許可）
    this.albSg = new ec2.SecurityGroup(this, 'Sg', {
      vpc: props.vpc,
      securityGroupName: 'cdk-3tier-alb-sg',
      description: 'Security group for ALB',
    });
    this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from internet');

    // ALB（Internet-facing・パブリックサブネット配置）
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: 'cdk-3tier-alb',
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: this.albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // ターゲットグループ（EC2 は Ec2Construct 内で登録する）
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      targetGroupName: 'cdk-3tier-tg',
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200',
      },
    });

    // HTTP:80 リスナー
    this.listener = this.alb.addListener('HttpListener', {
      port: 80,
      defaultTargetGroups: [this.targetGroup],
    });

    new cdk.CfnOutput(scope, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB の DNS 名（ブラウザでアクセス可能）',
    });
  }
}
