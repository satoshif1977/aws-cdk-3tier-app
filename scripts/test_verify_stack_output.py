"""
verify_stack.py 出力メッセージ・ヘルパー関数テスト

capsys を使って ok/ng/skip/section の出力フォーマットと
各 verify_* 関数の出力内容を検証する。
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from verify_stack import (
    DB_ENGINE,
    DB_VERSION_PREFIX,
    EXPECTED_BACKUP_RETENTION,
    EXPECTED_NAT_GW_COUNT,
    EXPECTED_SUBNET_COUNT,
    INSTANCE_TYPE,
    VPC_NAME,
    ng,
    ok,
    section,
    skip,
    verify_alb,
    verify_ec2,
    verify_rds,
    verify_vpc,
)

# ── ヘルパー関数 出力フォーマットテスト ────────────────────


class TestHelpers:
    def test_okの出力フォーマット(self, capsys: pytest.CaptureFixture[str]) -> None:
        ok("テスト成功")
        assert "[OK]" in capsys.readouterr().out

    def test_ngの出力フォーマット(self, capsys: pytest.CaptureFixture[str]) -> None:
        ng("テスト失敗")
        assert "[NG]" in capsys.readouterr().out

    def test_skipの出力フォーマット(self, capsys: pytest.CaptureFixture[str]) -> None:
        skip("スキップ")
        assert "[--]" in capsys.readouterr().out

    def test_sectionの出力にタイトルが含まれる(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        section("VPC検証")
        assert "VPC検証" in capsys.readouterr().out

    def test_sectionの出力にセパレータが含まれる(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        section("テスト")
        output = capsys.readouterr().out
        assert "=" * 50 in output

    def test_okのメッセージ内容が出力される(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        ok("VPC が存在します")
        assert "VPC が存在します" in capsys.readouterr().out

    def test_ngのメッセージ内容が出力される(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        ng("CIDR ブロックが想定外")
        assert "CIDR ブロックが想定外" in capsys.readouterr().out


# ── verify_vpc 出力テスト ──────────────────────────────────


def _setup_vpc_client(
    vpc_id: str = "vpc-001",
    cidr: str = "10.0.0.0/16",
    subnet_count: int = EXPECTED_SUBNET_COUNT,
    nat_count: int = EXPECTED_NAT_GW_COUNT,
) -> MagicMock:
    client = MagicMock()
    client.describe_vpcs.return_value = {"Vpcs": [{"VpcId": vpc_id, "CidrBlock": cidr}]}
    client.describe_subnets.return_value = {
        "Subnets": [{"SubnetId": f"sn-{i}"} for i in range(subnet_count)]
    }
    client.describe_nat_gateways.return_value = {
        "NatGateways": [{"NatGatewayId": f"nat-{i}"} for i in range(nat_count)]
    }
    return client


class TestVerifyVpcOutput:
    def test_VPC検出時にOKメッセージを出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = _setup_vpc_client()
        verify_vpc(client)
        assert "[OK]" in capsys.readouterr().out

    def test_VPC未検出時にNGメッセージを出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_vpcs.return_value = {"Vpcs": []}
        verify_vpc(client)
        assert "[NG]" in capsys.readouterr().out

    def test_誤ったCIDRでNGメッセージを出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = _setup_vpc_client(cidr="192.168.0.0/16")
        verify_vpc(client)
        output = capsys.readouterr().out
        assert "想定外" in output

    def test_サブネット不足でNGメッセージを出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = _setup_vpc_client(subnet_count=2)
        verify_vpc(client)
        output = capsys.readouterr().out
        assert "不足" in output

    def test_NAT_GW数不一致でNGメッセージを出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = _setup_vpc_client(nat_count=0)
        verify_vpc(client)
        output = capsys.readouterr().out
        assert "想定外" in output

    def test_出力にvpc_idが含まれる(self, capsys: pytest.CaptureFixture[str]) -> None:
        client = _setup_vpc_client(vpc_id="vpc-test-xyz")
        verify_vpc(client)
        assert "vpc-test-xyz" in capsys.readouterr().out


# ── verify_alb 出力テスト ──────────────────────────────────


def _make_alb(vpc_id: str = "vpc-001", scheme: str = "internet-facing") -> dict:
    return {
        "LoadBalancerArn": "arn:aws:elasticloadbalancing:ap-northeast-1:123:loadbalancer/app/test/abc",
        "LoadBalancerName": "test-alb",
        "Scheme": scheme,
        "VpcId": vpc_id,
    }


class TestVerifyAlbOutput:
    def test_vpc_id_Noneでスキップメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        verify_alb(MagicMock(), None)
        assert "[--]" in capsys.readouterr().out

    def test_ALB検出時にOKメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_load_balancers.return_value = {"LoadBalancers": [_make_alb()]}
        client.describe_target_groups.return_value = {
            "TargetGroups": [{"TargetGroupName": "tg-1", "HealthCheckPath": "/health"}]
        }
        verify_alb(client, "vpc-001")
        output = capsys.readouterr().out
        assert "test-alb" in output

    def test_ALB未検出時にNGメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_load_balancers.return_value = {"LoadBalancers": []}
        verify_alb(client, "vpc-001")
        assert "[NG]" in capsys.readouterr().out

    def test_TG未検出時にNGメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_load_balancers.return_value = {"LoadBalancers": [_make_alb()]}
        client.describe_target_groups.return_value = {"TargetGroups": []}
        verify_alb(client, "vpc-001")
        output = capsys.readouterr().out
        assert "ターゲットグループが見つかりません" in output

    def test_ヘルスチェックパスが出力される(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_load_balancers.return_value = {"LoadBalancers": [_make_alb()]}
        client.describe_target_groups.return_value = {
            "TargetGroups": [
                {"TargetGroupName": "tg-1", "HealthCheckPath": "/api/health"}
            ]
        }
        verify_alb(client, "vpc-001")
        assert "/api/health" in capsys.readouterr().out


# ── verify_ec2 出力テスト ──────────────────────────────────


class TestVerifyEc2Output:
    def test_vpc_id_Noneでスキップメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        verify_ec2(MagicMock(), None)
        assert "[--]" in capsys.readouterr().out

    def test_インスタンス未検出でNGメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_instances.return_value = {"Reservations": []}
        verify_ec2(client, "vpc-001")
        assert "[NG]" in capsys.readouterr().out

    def test_正しいインスタンスタイプでOK出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": "i-001",
                            "InstanceType": INSTANCE_TYPE,
                            "State": {"Name": "running"},
                        }
                    ]
                }
            ]
        }
        verify_ec2(client, "vpc-001")
        output = capsys.readouterr().out
        assert "i-001" in output
        assert INSTANCE_TYPE in output

    def test_誤ったインスタンスタイプでNG出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": "i-wrong",
                            "InstanceType": "m5.xlarge",
                            "State": {"Name": "running"},
                        }
                    ]
                }
            ]
        }
        verify_ec2(client, "vpc-001")
        output = capsys.readouterr().out
        assert "想定外" in output

    def test_インスタンス件数が出力される(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": f"i-{i:03d}",
                            "InstanceType": INSTANCE_TYPE,
                            "State": {"Name": "running"},
                        }
                        for i in range(3)
                    ]
                }
            ]
        }
        verify_ec2(client, "vpc-001")
        assert "3件" in capsys.readouterr().out

    def test_Reservations内のInstances空リスト(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_instances.return_value = {"Reservations": [{"Instances": []}]}
        verify_ec2(client, "vpc-001")
        assert "[NG]" in capsys.readouterr().out


# ── verify_rds 出力テスト ──────────────────────────────────


def _make_rds(
    engine: str = DB_ENGINE,
    version: str = "8.0.35",
    encrypted: bool = True,
    backup: int = EXPECTED_BACKUP_RETENTION,
    db_class: str = "db.t3.micro",
) -> dict:
    return {
        "DBInstanceIdentifier": "test-db",
        "Engine": engine,
        "EngineVersion": version,
        "StorageEncrypted": encrypted,
        "BackupRetentionPeriod": backup,
        "DBInstanceClass": db_class,
    }


class TestVerifyRdsOutput:
    def test_RDS検出時にOKメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {"DBInstances": [_make_rds()]}
        verify_rds(client)
        output = capsys.readouterr().out
        assert "test-db" in output

    def test_RDS未検出時にNGメッセージ出力(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {"DBInstances": []}
        verify_rds(client)
        assert "[NG]" in capsys.readouterr().out

    def test_暗号化有効でOK出力(self, capsys: pytest.CaptureFixture[str]) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {
            "DBInstances": [_make_rds(encrypted=True)]
        }
        verify_rds(client)
        assert "暗号化" in capsys.readouterr().out

    def test_暗号化無効でNG出力(self, capsys: pytest.CaptureFixture[str]) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {
            "DBInstances": [_make_rds(encrypted=False)]
        }
        verify_rds(client)
        output = capsys.readouterr().out
        assert "無効" in output

    def test_バックアップ不足でNG出力(self, capsys: pytest.CaptureFixture[str]) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {
            "DBInstances": [_make_rds(backup=1)]
        }
        verify_rds(client)
        assert "不足" in capsys.readouterr().out

    def test_エンジン不一致でNG出力(self, capsys: pytest.CaptureFixture[str]) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {
            "DBInstances": [_make_rds(engine="postgres", version="15.3")]
        }
        verify_rds(client)
        assert "想定外" in capsys.readouterr().out

    def test_複数RDSでも最初のインスタンスのみ検証(self) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {
            "DBInstances": [_make_rds(), _make_rds(engine="postgres")]
        }
        verify_rds(client)
        client.describe_db_instances.assert_called_once()

    def test_インスタンスクラスが出力に含まれる(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        client = MagicMock()
        client.describe_db_instances.return_value = {
            "DBInstances": [_make_rds(db_class="db.r6g.xlarge")]
        }
        verify_rds(client)
        assert "db.r6g.xlarge" in capsys.readouterr().out


# ── 定数値テスト ──────────────────────────────────────────


class TestConstants:
    def test_VPC_NAMEが設定されている(self) -> None:
        assert VPC_NAME == "cdk-3tier-vpc"

    def test_サブネット期待数が6(self) -> None:
        assert EXPECTED_SUBNET_COUNT == 6

    def test_NAT_GW期待数が1(self) -> None:
        assert EXPECTED_NAT_GW_COUNT == 1

    def test_インスタンスタイプがt3_micro(self) -> None:
        assert INSTANCE_TYPE == "t3.micro"

    def test_DBエンジンがmysql(self) -> None:
        assert DB_ENGINE == "mysql"

    def test_DBバージョンプレフィックスが8_0(self) -> None:
        assert DB_VERSION_PREFIX == "8.0"

    def test_バックアップ保持期間が7日(self) -> None:
        assert EXPECTED_BACKUP_RETENTION == 7
