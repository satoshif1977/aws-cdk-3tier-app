"""
aws-cdk-3tier-app スタック検証スクリプト

CDK デプロイ後に VPC・ALB・EC2・RDS リソースが
正しく作成されているかを boto3 で確認する。

使用方法:
    python scripts/verify_stack.py [--profile <プロファイル名>] [--region <リージョン>]

前提条件:
    pip install boto3
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

import boto3

# ── 定数 ──────────────────────────────────────────────────────────

VPC_NAME = "cdk-3tier-vpc"
EXPECTED_SUBNET_COUNT = 6  # Public×2 + Private×2 + DB×2
EXPECTED_NAT_GW_COUNT = 1  # コスト最適化: 1つ
INSTANCE_TYPE = "t3.micro"
DB_ENGINE = "mysql"
DB_VERSION_PREFIX = "8.0"
EXPECTED_BACKUP_RETENTION = 7  # 日


# ── ヘルパー ──────────────────────────────────────────────────────


def ok(msg: str) -> None:
    print(f"  [OK]  {msg}")


def ng(msg: str) -> None:
    print(f"  [NG]  {msg}")


def skip(msg: str) -> None:
    print(f"  [--]  {msg}")


def section(title: str) -> None:
    print(f"\n{'='*50}")
    print(f"  {title}")
    print("=" * 50)


# ── VPC 検証 ──────────────────────────────────────────────────────


def verify_vpc(ec2_client: Any) -> str | None:
    section("VPC")
    vpcs = ec2_client.describe_vpcs(
        Filters=[{"Name": "tag:Name", "Values": [VPC_NAME]}]
    )["Vpcs"]

    if not vpcs:
        ng(f"VPC '{VPC_NAME}' が見つかりません")
        return None

    vpc = vpcs[0]
    vpc_id = vpc["VpcId"]
    ok(f"VPC が存在します: {vpc_id}")

    if vpc["CidrBlock"] == "10.0.0.0/16":
        ok(f"CIDR ブロック正常: {vpc['CidrBlock']}")
    else:
        ng(f"CIDR ブロックが想定外: {vpc['CidrBlock']} (期待: 10.0.0.0/16)")

    # サブネット数確認
    subnets = ec2_client.describe_subnets(
        Filters=[{"Name": "vpc-id", "Values": [vpc_id]}]
    )["Subnets"]
    count = len(subnets)
    if count >= EXPECTED_SUBNET_COUNT:
        ok(f"サブネット数正常: {count}件（期待: {EXPECTED_SUBNET_COUNT}件以上）")
    else:
        ng(f"サブネット数不足: {count}件（期待: {EXPECTED_SUBNET_COUNT}件以上）")

    # NAT ゲートウェイ数確認
    nat_gws = ec2_client.describe_nat_gateways(
        Filters=[
            {"Name": "vpc-id", "Values": [vpc_id]},
            {"Name": "state", "Values": ["available"]},
        ]
    )["NatGateways"]
    nat_count = len(nat_gws)
    if nat_count == EXPECTED_NAT_GW_COUNT:
        ok(f"NAT ゲートウェイ数正常: {nat_count}件")
    else:
        ng(
            f"NAT ゲートウェイ数が想定外: {nat_count}件（期待: {EXPECTED_NAT_GW_COUNT}件）"
        )

    return vpc_id


# ── ALB 検証 ──────────────────────────────────────────────────────


def verify_alb(elb_client: Any, vpc_id: str | None) -> None:
    section("ALB（Application Load Balancer）")
    if not vpc_id:
        skip("VPC が未検出のためスキップ")
        return

    albs = elb_client.describe_load_balancers()["LoadBalancers"]
    vpc_albs = [alb for alb in albs if alb.get("VpcId") == vpc_id]

    if not vpc_albs:
        ng(f"VPC {vpc_id} に ALB が見つかりません")
        return

    alb = vpc_albs[0]
    alb_arn = alb["LoadBalancerArn"]
    ok(f"ALB が存在します: {alb['LoadBalancerName']}")

    if alb["Scheme"] == "internet-facing":
        ok("ALB スキーム正常: internet-facing")
    else:
        ng(f"ALB スキームが想定外: {alb['Scheme']} (期待: internet-facing)")

    # ターゲットグループ・ヘルスチェック確認
    tgs = elb_client.describe_target_groups(LoadBalancerArn=alb_arn)["TargetGroups"]
    if tgs:
        tg = tgs[0]
        ok(f"ターゲットグループが存在します: {tg['TargetGroupName']}")
        hc = tg["HealthCheckPath"]
        ok(f"ヘルスチェックパス: {hc}")
    else:
        ng("ターゲットグループが見つかりません")


# ── EC2 検証 ─────────────────────────────────────────────────────


def verify_ec2(ec2_client: Any, vpc_id: str | None) -> None:
    section("EC2")
    if not vpc_id:
        skip("VPC が未検出のためスキップ")
        return

    reservations = ec2_client.describe_instances(
        Filters=[
            {"Name": "vpc-id", "Values": [vpc_id]},
            {"Name": "instance-state-name", "Values": ["running", "stopped"]},
        ]
    )["Reservations"]

    instances = [i for r in reservations for i in r["Instances"]]
    if not instances:
        ng(f"VPC {vpc_id} に EC2 インスタンスが見つかりません")
        return

    ok(f"EC2 インスタンス数: {len(instances)}件")
    for inst in instances:
        itype = inst["InstanceType"]
        state = inst["State"]["Name"]
        iid = inst["InstanceId"]
        if itype == INSTANCE_TYPE:
            ok(f"  {iid}: {itype} ({state})")
        else:
            ng(f"  {iid}: インスタンスタイプが想定外 {itype} (期待: {INSTANCE_TYPE})")


# ── RDS 検証 ─────────────────────────────────────────────────────


def verify_rds(rds_client: Any) -> None:
    section("RDS")
    clusters = rds_client.describe_db_instances()["DBInstances"]

    if not clusters:
        ng("RDS インスタンスが見つかりません")
        return

    instance = clusters[0]
    ok(f"RDS インスタンスが存在します: {instance['DBInstanceIdentifier']}")

    engine = instance["Engine"]
    version = instance["EngineVersion"]
    if engine == DB_ENGINE and version.startswith(DB_VERSION_PREFIX):
        ok(f"エンジン正常: {engine} {version}")
    else:
        ng(
            f"エンジンが想定外: {engine} {version} (期待: {DB_ENGINE} {DB_VERSION_PREFIX}.x)"
        )

    if instance.get("StorageEncrypted"):
        ok("ストレージ暗号化: 有効")
    else:
        ng("ストレージ暗号化: 無効（本番では必須）")

    backup_retention = instance.get("BackupRetentionPeriod", 0)
    if backup_retention >= EXPECTED_BACKUP_RETENTION:
        ok(
            f"バックアップ保持期間: {backup_retention}日（期待: {EXPECTED_BACKUP_RETENTION}日以上）"
        )
    else:
        ng(
            f"バックアップ保持期間不足: {backup_retention}日（期待: {EXPECTED_BACKUP_RETENTION}日以上）"
        )

    iclass = instance["DBInstanceClass"]
    ok(f"インスタンスクラス: {iclass}")


# ── メイン ────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="aws-cdk-3tier-app スタック検証")
    parser.add_argument("--profile", default=None, help="AWS プロファイル名")
    parser.add_argument("--region", default="ap-northeast-1", help="AWS リージョン")
    args = parser.parse_args()

    print("\naws-cdk-3tier-app スタック検証")
    print(f"リージョン: {args.region}")
    print(f"プロファイル: {args.profile or 'デフォルト'}")

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    ec2_client = session.client("ec2")
    elb_client = session.client("elbv2")
    rds_client = session.client("rds")

    vpc_id = verify_vpc(ec2_client)
    verify_alb(elb_client, vpc_id)
    verify_ec2(ec2_client, vpc_id)
    verify_rds(rds_client)

    print(f"\n{'='*50}")
    print("  検証完了")
    print("=" * 50)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
