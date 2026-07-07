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

// ── VPC 追加テスト ─────────────────────────────────────────────
describe('VPC 詳細', () => {
  test('InternetGateway がサブネットにアタッチされる', () => {
    template.resourceCountIs('AWS::EC2::VPCGatewayAttachment', 1);
  });

  test('ルートテーブルが作成される', () => {
    // CDK は Public / Private / Isolated それぞれにルートテーブルを生成する
    const routeTables = template.findResources('AWS::EC2::RouteTable');
    expect(Object.keys(routeTables).length).toBeGreaterThanOrEqual(1);
  });
});

// ── ALB 追加テスト ─────────────────────────────────────────────
describe('ALB 詳細', () => {
  test('ターゲットグループのプロトコルが HTTP である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Protocol: 'HTTP',
    });
  });

  test('ターゲットグループのターゲットタイプが instance である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'instance',
    });
  });
});

// ── EC2 追加テスト ─────────────────────────────────────────────
describe('EC2 詳細', () => {
  test('EC2 インスタンスが 1 つ作成される', () => {
    template.resourceCountIs('AWS::EC2::Instance', 1);
  });
});

// ── RDS 追加テスト ─────────────────────────────────────────────
describe('RDS 詳細', () => {
  test('RDS DB サブネットグループが作成される', () => {
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
  });

  test('RDS MultiAZ が無効である（dev 環境）', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      MultiAZ: false,
    });
  });
});

// ── Monitoring テスト ──────────────────────────────────────────
describe('Monitoring', () => {
  test('CloudWatch Alarm が 1 つ以上作成される', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(1);
  });

  test('CloudWatch Dashboard が作成される', () => {
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });
});

// ── Monitoring 詳細テスト ───────────────────────────────────────
describe('Monitoring 詳細', () => {
  test('CloudWatch Alarm が 5 つ作成される（ALB 5xx / 非正常ホスト / EC2 CPU / RDS CPU / RDS ストレージ）', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 5);
  });

  test('ALB 5xx アラームの閾値が 5 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-alb-5xx-rate',
      Threshold: 5,
    });
  });

  test('ALB 非正常ホストアラームの閾値が 1 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-alb-unhealthy-hosts',
      Threshold: 1,
    });
  });

  test('EC2 CPU アラームの閾値が 80 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-ec2-cpu-high',
      Threshold: 80,
    });
  });

  test('RDS CPU アラームの閾値が 80 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-rds-cpu-high',
      Threshold: 80,
    });
  });

  test('CloudWatch Dashboard 名が cdk-3tier-app-dashboard である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'cdk-3tier-app-dashboard',
    });
  });
});

// ── RDS セキュリティ詳細テスト ──────────────────────────────────
describe('RDS セキュリティ詳細', () => {
  test('RDS インスタンス識別子が cdk-3tier-db である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceIdentifier: 'cdk-3tier-db',
    });
  });

  test('RDS 割り当てストレージが 20GB である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      AllocatedStorage: '20',
    });
  });

  test('RDS 削除保護が無効である（学習環境）', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: false,
    });
  });

  test('RDS パスワードが Secrets Manager で管理される', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });
});

// ── CfnOutput テスト ────────────────────────────────────────────
describe('CfnOutput', () => {
  test('CfnOutput が 3 つ以上存在する（DbEndpoint / DbSecretArn / DashboardUrl）', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(3);
  });

  test('Dashboard URL Output に ap-northeast-1 が含まれる', () => {
    const outputs = template.findOutputs('*');
    const allValues = JSON.stringify(outputs);
    expect(allValues).toContain('ap-northeast-1');
  });

  test('RDS エンドポイント Output が存在する', () => {
    const outputs = template.findOutputs('*');
    const allValues = JSON.stringify(outputs);
    expect(allValues.toLowerCase()).toContain('endpoint');
  });
});

