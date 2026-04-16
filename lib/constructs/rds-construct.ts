import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

interface RdsConstructProps {
  vpc: ec2.Vpc;
  ec2Sg: ec2.SecurityGroup;
}

export class RdsConstruct extends Construct {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: RdsConstructProps) {
    super(scope, id);

    // RDS 用セキュリティグループ（EC2 SG からの MySQL:3306 のみ許可）
    const rdsSg = new ec2.SecurityGroup(this, 'Sg', {
      vpc: props.vpc,
      securityGroupName: 'cdk-3tier-rds-sg',
      description: 'Security group for RDS MySQL',
    });
    rdsSg.addIngressRule(props.ec2Sg, ec2.Port.tcp(3306), 'Allow MySQL from EC2');

    // DB サブネットグループ（Isolated サブネット）
    const subnetGroup = new rds.SubnetGroup(this, 'SubnetGroup', {
      description: 'Subnet group for cdk-3tier RDS',
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // RDS MySQL 8.0
    this.dbInstance = new rds.DatabaseInstance(this, 'Instance', {
      instanceIdentifier: 'cdk-3tier-db',
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      securityGroups: [rdsSg],
      subnetGroup,
      multiAz: false,             // 学習用: false（本番は true 推奨）
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,  // 学習用: false（本番は true 推奨）
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      credentials: rds.Credentials.fromGeneratedSecret('admin', {
        secretName: 'cdk-3tier-db-secret',
      }),
    });

    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.dbInstance.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbInstance.secret?.secretArn ?? 'N/A' });
  }
}
