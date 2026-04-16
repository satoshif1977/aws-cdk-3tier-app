import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import { Construct } from 'constructs';

interface Ec2ConstructProps {
  vpc: ec2.Vpc;
  albSg: ec2.SecurityGroup;
  targetGroup: elbv2.ApplicationTargetGroup;
}

export class Ec2Construct extends Construct {
  public readonly ec2Sg: ec2.SecurityGroup;
  public readonly instance: ec2.Instance;

  constructor(scope: Construct, id: string, props: Ec2ConstructProps) {
    super(scope, id);

    // EC2 用セキュリティグループ（ALB SG からの HTTP:80 のみ許可）
    this.ec2Sg = new ec2.SecurityGroup(this, 'Sg', {
      vpc: props.vpc,
      securityGroupName: 'cdk-3tier-ec2-sg',
      description: 'Security group for EC2 web servers',
    });
    this.ec2Sg.addIngressRule(props.albSg, ec2.Port.tcp(80), 'Allow HTTP from ALB');

    // IAM ロール（SSM Session Manager でキーペアなしにログイン可能）
    const role = new iam.Role(this, 'Role', {
      roleName: 'cdk-3tier-ec2-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // UserData（Apache インストール・起動）
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf update -y',
      'dnf install -y httpd',
      'systemctl enable httpd',
      'systemctl start httpd',
      'echo "<h1>Hello from CDK 3-Tier App</h1>" > /var/www/html/index.html',
    );

    // EC2 インスタンス（プライベートサブネット配置）
    this.instance = new ec2.Instance(this, 'Instance', {
      instanceName: 'cdk-3tier-web',
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: this.ec2Sg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      role,
      userData,
    });

    // ALB ターゲットグループに EC2 を登録
    props.targetGroup.addTarget(new elbv2_targets.InstanceTarget(this.instance));

    new cdk.CfnOutput(this, 'InstanceId', { value: this.instance.instanceId });
  }
}
