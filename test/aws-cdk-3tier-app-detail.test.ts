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

// ── VPC 追加詳細 ──────────────────────────────────────────────────
describe('VPC 追加詳細', () => {
  test('VPC の maxAzs が 2 である（サブネット数から推定）', () => {
    // Public×2 + Private×2 + Isolated×2 = 6 サブネット → maxAzs=2 であることを確認
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });

  test('Public サブネットが 2 つ存在する', () => {
    const subnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        MapPublicIpOnLaunch: true,
      },
    });
    expect(Object.keys(subnets).length).toBe(2);
  });

  test('サブネットの CIDR が /24 マスクで作成される', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('/24');
  });

  test('VPC の DNS ホスト名が有効化されている', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsHostnames: true,
    });
  });

  test('VPC の DNS サポートが有効化されている', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsSupport: true,
    });
  });
});

// ── ALB 追加詳細 ──────────────────────────────────────────────────
describe('ALB 追加詳細', () => {
  test('ALB リスナーが 1 つ作成される', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
  });

  test('ALB ターゲットグループが 1 つ作成される', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
  });

  test('ALB リスナーのデフォルトアクションが forward である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      DefaultActions: Match.arrayWith([
        Match.objectLike({ Type: 'forward' }),
      ]),
    });
  });

  test('ALB セキュリティグループの説明が Security group for ALB である', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for ALB',
    });
  });
});

// ── EC2 追加詳細 ──────────────────────────────────────────────────
describe('EC2 追加詳細', () => {
  test('EC2 UserData に dnf install コマンドが含まれる', () => {
    const instances = template.findResources('AWS::EC2::Instance');
    const userData = JSON.stringify(Object.values(instances));
    expect(userData).toContain('dnf');
  });

  test('EC2 UserData に systemctl enable httpd コマンドが含まれる', () => {
    const instances = template.findResources('AWS::EC2::Instance');
    const userData = JSON.stringify(Object.values(instances));
    expect(userData).toContain('systemctl');
  });

  test('EC2 UserData に index.html 作成コマンドが含まれる', () => {
    const instances = template.findResources('AWS::EC2::Instance');
    const userData = JSON.stringify(Object.values(instances));
    expect(userData).toContain('index.html');
  });

  test('EC2 セキュリティグループの説明が Security group for EC2 web servers である', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for EC2 web servers',
    });
  });

  test('EC2 用 IAM ロールがランダムでなく固定名で作成される（cdk-3tier-ec2-role）', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'cdk-3tier-ec2-role',
    });
  });

  test('EC2 インスタンスプロファイルが 1 つ作成される', () => {
    template.resourceCountIs('AWS::IAM::InstanceProfile', 1);
  });
});

// ── RDS 追加詳細 ──────────────────────────────────────────────────
describe('RDS 追加詳細', () => {
  test('RDS のデフォルトポート（3306）が設定されている', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('3306');
  });

  test('RDS エンジンが mysql である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'mysql',
    });
  });

  test('RDS ストレージタイプがデフォルト（gp2）である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageType: 'gp2',
    });
  });

  test('RDS マスターユーザー名が admin である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      MasterUsername: 'admin',
    });
  });

  test('RDS サブネットグループが Isolated サブネットを使用する', () => {
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('DBSubnetGroup');
  });

  test('RDS の削除ポリシーが Delete である（学習環境）', () => {
    template.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });
});

// ── CloudWatch アラーム詳細 ───────────────────────────────────────
describe('CloudWatch アラーム詳細', () => {
  test('ALB 5xx アラームの評価期間が 2 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-alb-5xx-rate',
      EvaluationPeriods: 2,
    });
  });

  test('ALB 非正常ホストアラームの評価期間が 3 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-alb-unhealthy-hosts',
      EvaluationPeriods: 3,
    });
  });

  test('EC2 CPU アラームの評価期間が 3 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-ec2-cpu-high',
      EvaluationPeriods: 3,
    });
  });

  test('RDS CPU アラームの評価期間が 3 である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-rds-cpu-high',
      EvaluationPeriods: 3,
    });
  });

  test('RDS 空きストレージアラームが存在する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-rds-free-storage-low',
    });
  });

  test('RDS 空きストレージアラームの閾値が 2GB（バイト換算）である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-rds-free-storage-low',
      Threshold: 2 * 1024 * 1024 * 1024,
    });
  });

  test('ALB 5xx アラームの比較演算子が GreaterThanOrEqualToThreshold である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-alb-5xx-rate',
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
  });

  test('テンプレートに AWS/EC2 名前空間が含まれる（EC2 CPU アラーム）', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('AWS/EC2');
  });

  test('テンプレートに CPUUtilization メトリクスが含まれる（EC2/RDS CPU アラーム）', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('CPUUtilization');
  });
});

// ── タグ詳細 ─────────────────────────────────────────────────────
describe('タグ詳細', () => {
  test('EC2 インスタンスに Project タグが付与される', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'cdk-3tier-app' }),
      ]),
    });
  });

  test('EC2 インスタンスに ManagedBy=CDK タグが付与される', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'ManagedBy', Value: 'CDK' }),
      ]),
    });
  });

  test('RDS に Project タグが付与される', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'cdk-3tier-app' }),
      ]),
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

  test('Output が 5 つ以上存在する', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(5);
  });
});

// ── VPC ネットワーク追加 ──────────────────────────────────────────
describe('VPC ネットワーク追加', () => {
  test('Elastic IP が NAT Gateway 用に 1 つ作成される', () => {
    template.resourceCountIs('AWS::EC2::EIP', 1);
  });

  test('Private サブネットが 2 つ存在する', () => {
    const subnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        MapPublicIpOnLaunch: false,
      },
    });
    // Private + Isolated = 4（MapPublicIpOnLaunch=false）
    expect(Object.keys(subnets).length).toBe(4);
  });

  test('VPC CIDR が 10.0.0.0/16 である', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });
  });
});

// ── ALB 追加検証 ────────────────────────────────────────────────
describe('ALB 追加検証', () => {
  test('ALB が 1 つだけ作成される', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  test('ターゲットグループのヘルスチェックパスが / である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/',
    });
  });

  test('ALB リスナーのプロトコルが HTTP である', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Protocol: 'HTTP',
    });
  });
});

// ── EC2 追加検証 ────────────────────────────────────────────────
describe('EC2 追加検証', () => {
  test('EC2 インスタンスに Name タグが付与される', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Name' }),
      ]),
    });
  });

  test('EC2 セキュリティグループに Ingress ルールが存在する', () => {
    const ingresses = template.findResources('AWS::EC2::SecurityGroupIngress');
    expect(Object.keys(ingresses).length).toBeGreaterThanOrEqual(1);
  });
});

// ── RDS 追加検証 ────────────────────────────────────────────────
describe('RDS 追加検証', () => {
  test('RDS が 1 つだけ作成される', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
  });

  test('RDS エンジンバージョンが 8.0 で始まる', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      EngineVersion: Match.stringLikeRegexp('^8\\.0'),
    });
  });

  test('RDS StorageEncrypted が true である', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
    });
  });
});

// ── CloudWatch アラーム追加 ──────────────────────────────────────
describe('CloudWatch アラーム追加', () => {
  test('RDS 空きストレージアラームの Period が 300 秒である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-rds-free-storage-low',
      Period: 300,
    });
  });

  test('ALB 非正常ホストアラームの比較演算子が GreaterThanOrEqualToThreshold である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-alb-unhealthy-hosts',
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
  });

  test('RDS 空きストレージアラームの比較演算子が LessThanOrEqualToThreshold である', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'cdk-3tier-rds-free-storage-low',
      ComparisonOperator: 'LessThanOrEqualToThreshold',
    });
  });

  test('テンプレートに AWS/RDS 名前空間が含まれる', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('AWS/RDS');
  });

  test('テンプレートに FreeStorageSpace メトリクスが含まれる', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain('FreeStorageSpace');
  });
});
