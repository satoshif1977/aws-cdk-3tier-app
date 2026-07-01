"""
aws-cdk-3tier-app スタック検証スクリプト ユニットテスト

boto3 クライアントをモックして AWS 接続なしで verify_stack.py の動作を検証する。
実行: pytest scripts/test_verify_stack.py -v
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from verify_stack import (
    EXPECTED_BACKUP_RETENTION,
    EXPECTED_NAT_GW_COUNT,
    EXPECTED_SUBNET_COUNT,
    INSTANCE_TYPE,
    verify_alb,
    verify_ec2,
    verify_rds,
    verify_vpc,
)


# ── フィクスチャ ───────────────────────────────────────────────────


@pytest.fixture
def ec2_client() -> MagicMock:
    return MagicMock()


@pytest.fixture
def elb_client() -> MagicMock:
    return MagicMock()


@pytest.fixture
def rds_client() -> MagicMock:
    return MagicMock()


def _make_vpc(vpc_id: str = "vpc-abc123", cidr: str = "10.0.0.0/16") -> dict:
    return {"VpcId": vpc_id, "CidrBlock": cidr}


def _make_subnet(subnet_id: str) -> dict:
    return {"SubnetId": subnet_id}


def _make_nat_gw(nat_id: str) -> dict:
    return {"NatGatewayId": nat_id}


# ── verify_vpc テスト ─────────────────────────────────────────────


class TestVerifyVpc:
    def test_VPCが存在する場合はvpc_idを返す(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": [_make_vpc("vpc-001")]}
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(EXPECTED_SUBNET_COUNT)]
        }
        ec2_client.describe_nat_gateways.return_value = {
            "NatGateways": [_make_nat_gw("nat-1")]
        }
        result = verify_vpc(ec2_client)
        assert result == "vpc-001"

    def test_VPCが見つからない場合はNoneを返す(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": []}
        result = verify_vpc(ec2_client)
        assert result is None

    def test_正しいCIDRの場合は検証が通る(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {
            "Vpcs": [_make_vpc(cidr="10.0.0.0/16")]
        }
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(EXPECTED_SUBNET_COUNT)]
        }
        ec2_client.describe_nat_gateways.return_value = {
            "NatGateways": [_make_nat_gw("nat-1")]
        }
        result = verify_vpc(ec2_client)
        assert result is not None

    def test_誤ったCIDRでもvpc_idは返す(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {
            "Vpcs": [_make_vpc(vpc_id="vpc-bad", cidr="192.168.0.0/16")]
        }
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(EXPECTED_SUBNET_COUNT)]
        }
        ec2_client.describe_nat_gateways.return_value = {
            "NatGateways": [_make_nat_gw("nat-1")]
        }
        result = verify_vpc(ec2_client)
        assert result == "vpc-bad"

    def test_サブネット数が期待値以上の場合は正常(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": [_make_vpc()]}
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(EXPECTED_SUBNET_COUNT + 2)]
        }
        ec2_client.describe_nat_gateways.return_value = {
            "NatGateways": [_make_nat_gw("nat-1")]
        }
        result = verify_vpc(ec2_client)
        assert result is not None

    def test_サブネット数が不足する場合もvpc_idは返す(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": [_make_vpc()]}
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(2)]
        }
        ec2_client.describe_nat_gateways.return_value = {
            "NatGateways": [_make_nat_gw("nat-1")]
        }
        result = verify_vpc(ec2_client)
        assert result is not None

    def test_NATゲートウェイ数が期待値通りの場合は正常(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": [_make_vpc()]}
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(EXPECTED_SUBNET_COUNT)]
        }
        ec2_client.describe_nat_gateways.return_value = {
            "NatGateways": [_make_nat_gw(f"nat-{i}") for i in range(EXPECTED_NAT_GW_COUNT)]
        }
        result = verify_vpc(ec2_client)
        assert result is not None

    def test_NATゲートウェイが0件でもvpc_idは返す(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": [_make_vpc()]}
        ec2_client.describe_subnets.return_value = {
            "Subnets": [_make_subnet(f"sn-{i}") for i in range(EXPECTED_SUBNET_COUNT)]
        }
        ec2_client.describe_nat_gateways.return_value = {"NatGateways": []}
        result = verify_vpc(ec2_client)
        assert result is not None

    def test_describe_vpcsが正しいフィルタで呼ばれる(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_vpcs.return_value = {"Vpcs": []}
        verify_vpc(ec2_client)
        call_kwargs = ec2_client.describe_vpcs.call_args[1]
        filters = call_kwargs["Filters"]
        names = [f["Name"] for f in filters]
        assert "tag:Name" in names


# ── verify_alb テスト ─────────────────────────────────────────────


class TestVerifyAlb:
    def test_vpc_idがNoneの場合はスキップする(self, elb_client: MagicMock) -> None:
        verify_alb(elb_client, None)
        elb_client.describe_load_balancers.assert_not_called()

    def test_ALBが見つからない場合は処理を終了する(self, elb_client: MagicMock) -> None:
        elb_client.describe_load_balancers.return_value = {"LoadBalancers": []}
        verify_alb(elb_client, "vpc-001")
        elb_client.describe_target_groups.assert_not_called()

    def test_internet_facingスキームが正常と判定される(self, elb_client: MagicMock) -> None:
        alb = {
            "LoadBalancerArn": "arn:aws:elasticloadbalancing:ap-northeast-1:123:loadbalancer/app/test/abc",
            "LoadBalancerName": "test-alb",
            "Scheme": "internet-facing",
            "VpcId": "vpc-001",
        }
        elb_client.describe_load_balancers.return_value = {"LoadBalancers": [alb]}
        elb_client.describe_target_groups.return_value = {
            "TargetGroups": [
                {"TargetGroupName": "test-tg", "HealthCheckPath": "/health"}
            ]
        }
        verify_alb(elb_client, "vpc-001")
        elb_client.describe_target_groups.assert_called_once()

    def test_internalスキームの場合も処理を継続する(self, elb_client: MagicMock) -> None:
        alb = {
            "LoadBalancerArn": "arn:aws:elasticloadbalancing:ap-northeast-1:123:loadbalancer/app/test/abc",
            "LoadBalancerName": "test-alb",
            "Scheme": "internal",
            "VpcId": "vpc-001",
        }
        elb_client.describe_load_balancers.return_value = {"LoadBalancers": [alb]}
        elb_client.describe_target_groups.return_value = {"TargetGroups": []}
        verify_alb(elb_client, "vpc-001")
        elb_client.describe_target_groups.assert_called_once()

    def test_ターゲットグループが存在しない場合も終了しない(self, elb_client: MagicMock) -> None:
        alb = {
            "LoadBalancerArn": "arn:aws:elasticloadbalancing:ap-northeast-1:123:loadbalancer/app/test/abc",
            "LoadBalancerName": "test-alb",
            "Scheme": "internet-facing",
            "VpcId": "vpc-001",
        }
        elb_client.describe_load_balancers.return_value = {"LoadBalancers": [alb]}
        elb_client.describe_target_groups.return_value = {"TargetGroups": []}
        verify_alb(elb_client, "vpc-001")

    def test_VPC外のALBは対象外となる(self, elb_client: MagicMock) -> None:
        other_alb = {
            "LoadBalancerArn": "arn:aws:elasticloadbalancing:ap-northeast-1:123:loadbalancer/app/other/xyz",
            "LoadBalancerName": "other-alb",
            "Scheme": "internet-facing",
            "VpcId": "vpc-other",
        }
        elb_client.describe_load_balancers.return_value = {"LoadBalancers": [other_alb]}
        verify_alb(elb_client, "vpc-001")
        elb_client.describe_target_groups.assert_not_called()


# ── verify_ec2 テスト ─────────────────────────────────────────────


class TestVerifyEc2:
    def test_vpc_idがNoneの場合はスキップする(self, ec2_client: MagicMock) -> None:
        verify_ec2(ec2_client, None)
        ec2_client.describe_instances.assert_not_called()

    def test_インスタンスが見つからない場合は処理を終了する(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_instances.return_value = {"Reservations": []}
        verify_ec2(ec2_client, "vpc-001")

    def test_正しいインスタンスタイプで件数を表示する(self, ec2_client: MagicMock) -> None:
        reservation = {
            "Instances": [
                {
                    "InstanceId": "i-001",
                    "InstanceType": INSTANCE_TYPE,
                    "State": {"Name": "running"},
                }
            ]
        }
        ec2_client.describe_instances.return_value = {"Reservations": [reservation]}
        verify_ec2(ec2_client, "vpc-001")
        ec2_client.describe_instances.assert_called_once()

    def test_誤ったインスタンスタイプでも処理を継続する(self, ec2_client: MagicMock) -> None:
        reservation = {
            "Instances": [
                {
                    "InstanceId": "i-002",
                    "InstanceType": "t2.large",
                    "State": {"Name": "running"},
                }
            ]
        }
        ec2_client.describe_instances.return_value = {"Reservations": [reservation]}
        verify_ec2(ec2_client, "vpc-001")
        ec2_client.describe_instances.assert_called_once()

    def test_複数インスタンスの場合はすべて処理する(self, ec2_client: MagicMock) -> None:
        reservations = [
            {
                "Instances": [
                    {
                        "InstanceId": f"i-{i:03d}",
                        "InstanceType": INSTANCE_TYPE,
                        "State": {"Name": "running"},
                    }
                ]
            }
            for i in range(3)
        ]
        ec2_client.describe_instances.return_value = {"Reservations": reservations}
        verify_ec2(ec2_client, "vpc-001")
        ec2_client.describe_instances.assert_called_once()

    def test_describe_instancesにvpc_idフィルタが渡される(self, ec2_client: MagicMock) -> None:
        ec2_client.describe_instances.return_value = {"Reservations": []}
        verify_ec2(ec2_client, "vpc-test-123")
        call_kwargs = ec2_client.describe_instances.call_args[1]
        filters = call_kwargs["Filters"]
        vpc_filter = next((f for f in filters if f["Name"] == "vpc-id"), None)
        assert vpc_filter is not None
        assert "vpc-test-123" in vpc_filter["Values"]


# ── verify_rds テスト ─────────────────────────────────────────────


class TestVerifyRds:
    def _make_rds_instance(
        self,
        engine: str = "mysql",
        version: str = "8.0.35",
        encrypted: bool = True,
        backup_retention: int = 7,
        db_class: str = "db.t3.micro",
    ) -> dict:
        return {
            "DBInstanceIdentifier": "test-db",
            "Engine": engine,
            "EngineVersion": version,
            "StorageEncrypted": encrypted,
            "BackupRetentionPeriod": backup_retention,
            "DBInstanceClass": db_class,
        }

    def test_RDSインスタンスが見つからない場合は処理を終了する(
        self, rds_client: MagicMock
    ) -> None:
        rds_client.describe_db_instances.return_value = {"DBInstances": []}
        verify_rds(rds_client)
        rds_client.describe_db_instances.assert_called_once()

    def test_正しいエンジンとバージョンで正常判定(self, rds_client: MagicMock) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(engine="mysql", version="8.0.35")]
        }
        verify_rds(rds_client)
        rds_client.describe_db_instances.assert_called_once()

    def test_誤ったエンジンでも処理を継続する(self, rds_client: MagicMock) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(engine="postgres", version="15.3")]
        }
        verify_rds(rds_client)

    def test_バージョンプレフィックスが異なる場合も処理を継続する(
        self, rds_client: MagicMock
    ) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(version="5.7.44")]
        }
        verify_rds(rds_client)

    def test_暗号化有効の場合は正常判定(self, rds_client: MagicMock) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(encrypted=True)]
        }
        verify_rds(rds_client)

    def test_暗号化無効でも処理を継続する(self, rds_client: MagicMock) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(encrypted=False)]
        }
        verify_rds(rds_client)

    def test_バックアップ保持期間が十分な場合は正常判定(
        self, rds_client: MagicMock
    ) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [
                self._make_rds_instance(backup_retention=EXPECTED_BACKUP_RETENTION)
            ]
        }
        verify_rds(rds_client)

    def test_バックアップ保持期間が不足する場合も処理を継続する(
        self, rds_client: MagicMock
    ) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(backup_retention=1)]
        }
        verify_rds(rds_client)

    def test_バックアップ保持期間が期待値より多い場合も正常(
        self, rds_client: MagicMock
    ) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [
                self._make_rds_instance(backup_retention=EXPECTED_BACKUP_RETENTION + 7)
            ]
        }
        verify_rds(rds_client)

    def test_インスタンスクラスが出力される(self, rds_client: MagicMock) -> None:
        rds_client.describe_db_instances.return_value = {
            "DBInstances": [self._make_rds_instance(db_class="db.r6g.large")]
        }
        verify_rds(rds_client)
        rds_client.describe_db_instances.assert_called_once()


# ── main 統合テスト ───────────────────────────────────────────────


class TestMain:
    @patch("verify_stack.boto3.Session")
    def test_デフォルト引数でmainが完走する(self, mock_session: MagicMock) -> None:
        from verify_stack import main

        mock_sess = MagicMock()
        mock_session.return_value = mock_sess

        ec2 = MagicMock()
        ec2.describe_vpcs.return_value = {"Vpcs": []}
        mock_sess.client.side_effect = lambda svc: {
            "ec2": ec2,
            "elbv2": MagicMock(
                describe_load_balancers=MagicMock(return_value={"LoadBalancers": []})
            ),
            "rds": MagicMock(
                describe_db_instances=MagicMock(return_value={"DBInstances": []})
            ),
        }.get(svc, MagicMock())

        import sys

        original_argv = sys.argv
        sys.argv = ["verify_stack.py"]
        try:
            main()
            mock_session.assert_called_once()
        finally:
            sys.argv = original_argv

    @patch("verify_stack.boto3.Session")
    def test_カスタムリージョンとプロファイルで呼ばれる(
        self, mock_session: MagicMock
    ) -> None:
        from verify_stack import main

        mock_sess = MagicMock()
        mock_session.return_value = mock_sess

        ec2 = MagicMock()
        ec2.describe_vpcs.return_value = {"Vpcs": []}
        mock_sess.client.side_effect = lambda svc: {
            "ec2": ec2,
            "elbv2": MagicMock(
                describe_load_balancers=MagicMock(return_value={"LoadBalancers": []})
            ),
            "rds": MagicMock(
                describe_db_instances=MagicMock(return_value={"DBInstances": []})
            ),
        }.get(svc, MagicMock())

        import sys

        original_argv = sys.argv
        sys.argv = ["verify_stack.py", "--region", "us-east-1", "--profile", "my-profile"]
        try:
            main()
            mock_session.assert_called_with(
                profile_name="my-profile", region_name="us-east-1"
            )
        finally:
            sys.argv = original_argv
