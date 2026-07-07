import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AppStack } from '../lib/app-stack';

const app = new cdk.App();
const stack = new AppStack(app, 'TestStack', {
  env: { account: '123456789012', region: 'ap-northeast-1' },
});
const template = Template.fromStack(stack);

// ── リソース名 ────────────────────────────────────────────────────
describe('リソース名', () => {
  test('VPC 名が cdk-3tier-vpc である', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Name', Value: 'cdk-3tier-vpc' }),
      ]),
    });
  });

  test('ALB 名が cdk-3tier-alb である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Name: 'cdk-3tier-alb',
    });
  });

  test('ターゲットグループ名が cdk-3tier-tg である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Name: 'cdk-3tier-tg',
    });
  });

  test('EC2 IAM ロール名が cdk-3tier-ec2-role である', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'cdk-3tier-ec2-role',
    });
  });

  test('RDS Secrets Manager シークレット名が cdk-3tier-db-secret である', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'cdk-3tier-db-secret',
    });
  });
});

// ── セキュリティグループ ──────────────────────────────────────────
describe('セキュリティグループ', () => {
  test('セキュリティグループが 3 件作成される（ALB・EC2・RDS）', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroup', 3);
  });

  test('ALB セキュリティグループ名が cdk-3tier-alb-sg である', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupName: 'cdk-3tier-alb-sg',
    });
  });

  test('EC2 セキュリティグループ名が cdk-3tier-ec2-sg である', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupName: 'cdk-3tier-ec2-sg',
    });
  });

  test('RDS セキュリティグループ名が cdk-3tier-rds-sg である', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupName: 'cdk-3tier-rds-sg',
    });
  });
});

// ── EC2 詳細 ────────────────────────────────────────────────────
describe('EC2 詳細', () => {
  test('EC2 UserData に httpd インストールコマンドが含まれる', () => {
    const instances = template.findResources('AWS::EC2::Instance');
    const userData = JSON.stringify(Object.values(instances));
    expect(userData).toContain('httpd');
  });

  test('EC2 IAM ロールが 1 件作成される', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
  });
});

// ── ターゲットグループ詳細 ────────────────────────────────────────
describe('ターゲットグループ詳細', () => {
  test('ターゲットグループのポートが 80 である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 80,
    });
  });
});

// ── CfnOutput ────────────────────────────────────────────────────
describe('CfnOutput 詳細', () => {
  test('VpcId Output が存在する', () => {
    const outputs = template.findOutputs('*');
    const allKeys = JSON.stringify(Object.keys(outputs));
    expect(allKeys.toLowerCase()).toContain('vpcid');
  });

  test('AlbDnsName Output が存在する', () => {
    const outputs = template.findOutputs('*');
    const allKeys = JSON.stringify(Object.keys(outputs));
    expect(allKeys.toLowerCase()).toContain('albdnsname');
  });

  test('InstanceId Output が存在する', () => {
    const outputs = template.findOutputs('*');
    const allKeys = JSON.stringify(Object.keys(outputs));
    expect(allKeys.toLowerCase()).toContain('instanceid');
  });

  test('DbEndpoint Output が存在する', () => {
    const outputs = template.findOutputs('*');
    const allKeys = JSON.stringify(Object.keys(outputs));
    expect(allKeys.toLowerCase()).toContain('dbendpoint');
  });

  test('DbSecretArn Output が存在する', () => {
    const outputs = template.findOutputs('*');
    const allKeys = JSON.stringify(Object.keys(outputs));
    expect(allKeys.toLowerCase()).toContain('dbsecretarn');
  });
});
