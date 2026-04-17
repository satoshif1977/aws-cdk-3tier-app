import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AppStack } from '../lib/app-stack';

// テスト共通: スタックを一度だけ合成してテンプレートを取得
const app = new cdk.App();
const stack = new AppStack(app, 'TestStack', {
  env: { account: '123456789012', region: 'ap-northeast-1' },
});
const template = Template.fromStack(stack);

// ── VPC テスト ────────────────────────────────────────────────
describe('VPC', () => {
  test('VPC が 10.0.0.0/16 で作成される', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });
  });

  test('サブネットが 6 つ作成される（Public×2, Private×2, Isolated×2）', () => {
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });

  test('NAT Gateway が 1 つ作成される（コスト最適化）', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  test('Internet Gateway が 1 つ作成される', () => {
    template.resourceCountIs('AWS::EC2::InternetGateway', 1);
  });
});

// ── ALB テスト ────────────────────────────────────────────────
describe('ALB', () => {
  test('ALB が Internet-facing で作成される', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application',
    });
  });

  test('ALB セキュリティグループが HTTP:80 をインターネットから許可する', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for ALB',
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          IpProtocol: 'tcp',
          FromPort: 80,
          ToPort: 80,
          CidrIp: '0.0.0.0/0',
        }),
      ]),
    });
  });

  test('ALB リスナーが HTTP:80 で作成される', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
    });
  });

  test('ターゲットグループのヘルスチェックパスが / である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/',
      Matcher: { HttpCode: '200' },
    });
  });
});

// ── EC2 テスト ────────────────────────────────────────────────
describe('EC2', () => {
  test('EC2 インスタンスが t3.micro で作成される', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.micro',
    });
  });

  test('EC2 IAM ロールに SSMManagedInstanceCore ポリシーが付与される', () => {
    // EC2 用 IAM ロールが存在することを確認
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'ec2.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      }),
    });
    // テンプレートに AmazonSSMManagedInstanceCore ポリシーが含まれることを確認
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('AmazonSSMManagedInstanceCore');
  });

  test('EC2 セキュリティグループへの HTTP:80 インバウンドルールが存在する', () => {
    // CDK は SG ピア参照を AWS::EC2::SecurityGroupIngress リソースとして別途生成する
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: 80,
      ToPort: 80,
      Description: 'Allow HTTP from ALB',
    });
  });
});

// ── RDS テスト ────────────────────────────────────────────────
describe('RDS', () => {
  test('RDS が MySQL 8.0 で作成される', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'mysql',
      EngineVersion: Match.stringLikeRegexp('^8\\.0'),
    });
  });

  test('RDS ストレージ暗号化が有効である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
    });
  });

  test('RDS バックアップ保持期間が 7 日である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      BackupRetentionPeriod: 7,
    });
  });

  test('RDS が db.t3.micro で作成される', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t3.micro',
    });
  });

  test('RDS セキュリティグループへの MySQL:3306 インバウンドルールが存在する（EC2 SG からのみ）', () => {
    // CDK は SG ピア参照を AWS::EC2::SecurityGroupIngress リソースとして別途生成する
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: 3306,
      ToPort: 3306,
      Description: 'Allow MySQL from EC2',
    });
  });
});

// ── タグ テスト ────────────────────────────────────────────────
describe('タグ', () => {
  test('スタックに Project タグが付与される', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'cdk-3tier-app' }),
      ]),
    });
  });

  test('スタックに ManagedBy=CDK タグが付与される', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'ManagedBy', Value: 'CDK' }),
      ]),
    });
  });
});
