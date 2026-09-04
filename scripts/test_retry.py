"""
retry.py ユニットテスト

sleep / rand を注入して、実待機ゼロかつ決定的に検証する。
実行: pytest scripts/test_retry.py -v
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)

sys.path.insert(0, os.path.dirname(__file__))

from retry import (  # noqa: E402
    DEFAULT_CONFIG,
    RetryConfig,
    compute_delay,
    extract_error_code,
    extract_status_code,
    is_retryable,
    retry_call,
    with_retry,
)


# ── テスト用ヘルパー ───────────────────────────────────────────────
def make_client_error(
    code: str = "ThrottlingException", status: int | None = None
) -> ClientError:
    """指定のエラーコード / ステータスコードを持つ ClientError を組み立てる。"""
    response: dict = {"Error": {"Code": code, "Message": "テスト用"}}
    if status is not None:
        response["ResponseMetadata"] = {"HTTPStatusCode": status}
    return ClientError(response, "TestOperation")


class RecordingSleep:
    """呼ばれた待機秒数を記録するだけの sleep 代替。"""

    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


# ── RetryConfig ───────────────────────────────────────────────────
class TestRetryConfig:
    def test_既定値(self) -> None:
        assert DEFAULT_CONFIG.max_attempts == 3
        assert DEFAULT_CONFIG.base_delay == 0.5
        assert DEFAULT_CONFIG.max_delay == 8.0
        assert DEFAULT_CONFIG.jitter is True

    def test_max_attempts_が0以下なら例外(self) -> None:
        with pytest.raises(ValueError, match="max_attempts"):
            RetryConfig(max_attempts=0)

    def test_base_delay_が0以下なら例外(self) -> None:
        with pytest.raises(ValueError, match="base_delay"):
            RetryConfig(base_delay=0)

    def test_max_delay_が_base_delay_未満なら例外(self) -> None:
        with pytest.raises(ValueError, match="max_delay"):
            RetryConfig(base_delay=2.0, max_delay=1.0)

    def test_不変(self) -> None:
        with pytest.raises(Exception):
            DEFAULT_CONFIG.max_attempts = 99  # type: ignore[misc]


# ── エラー情報の取り出し ──────────────────────────────────────────
class TestExtractErrorCode:
    def test_ClientErrorからコードを取得(self) -> None:
        assert extract_error_code(make_client_error("Throttling")) == "Throttling"

    def test_ClientError以外は空文字(self) -> None:
        assert extract_error_code(ValueError("なにか")) == ""

    def test_Errorキーが無ければ空文字(self) -> None:
        exc = ClientError({"ResponseMetadata": {}}, "Op")
        assert extract_error_code(exc) == ""


class TestExtractStatusCode:
    def test_ステータスコードを取得(self) -> None:
        assert extract_status_code(make_client_error("Unknown", 503)) == 503

    def test_ClientError以外はNone(self) -> None:
        assert extract_status_code(RuntimeError("なにか")) is None

    def test_メタデータが無ければNone(self) -> None:
        assert extract_status_code(make_client_error("Throttling")) is None


# ── リトライ可否の判定 ────────────────────────────────────────────
class TestIsRetryable:
    @pytest.mark.parametrize(
        "code",
        [
            "ThrottlingException",
            "Throttling",
            "TooManyRequestsException",
            "RequestLimitExceeded",
            "Client.RequestLimitExceeded",
            "InternalServerError",
            "ServiceUnavailable",
            "RequestTimeout",
        ],
    )
    def test_リトライ対象のエラーコード(self, code: str) -> None:
        assert is_retryable(make_client_error(code)) is True

    @pytest.mark.parametrize(
        "code",
        [
            "AccessDenied",
            "UnauthorizedOperation",
            "ValidationError",
            "InvalidParameterValue",
            "ResourceNotFoundException",
        ],
    )
    def test_リトライ不能なエラーコード(self, code: str) -> None:
        assert is_retryable(make_client_error(code)) is False

    @pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
    def test_ステータスコードだけでも判定できる(self, status: int) -> None:
        assert is_retryable(make_client_error("SomethingUnknown", status)) is True

    @pytest.mark.parametrize("status", [400, 403, 404, 409])
    def test_4xxはリトライしない(self, status: int) -> None:
        assert is_retryable(make_client_error("SomethingUnknown", status)) is False

    def test_ネットワーク層の一時障害はリトライ対象(self) -> None:
        assert is_retryable(ConnectTimeoutError(endpoint_url="https://ec2")) is True
        assert is_retryable(ReadTimeoutError(endpoint_url="https://ec2")) is True
        assert is_retryable(EndpointConnectionError(endpoint_url="https://ec2")) is True

    def test_無関係な例外はリトライしない(self) -> None:
        assert is_retryable(ValueError("なにか")) is False
        assert is_retryable(KeyError("Vpcs")) is False


# ── 待機秒数の計算 ────────────────────────────────────────────────
class TestComputeDelay:
    def test_指数バックオフ(self) -> None:
        config = RetryConfig(base_delay=1.0, max_delay=100.0, jitter=False)
        assert compute_delay(1, config) == 1.0
        assert compute_delay(2, config) == 2.0
        assert compute_delay(3, config) == 4.0
        assert compute_delay(4, config) == 8.0

    def test_max_delayで頭打ちになる(self) -> None:
        config = RetryConfig(base_delay=1.0, max_delay=5.0, jitter=False)
        assert compute_delay(10, config) == 5.0

    def test_フルジッターは0から上限の間に散る(self) -> None:
        config = RetryConfig(base_delay=1.0, max_delay=100.0, jitter=True)
        assert compute_delay(3, config, rand=lambda: 0.0) == 0.0
        assert compute_delay(3, config, rand=lambda: 1.0) == 4.0
        assert compute_delay(3, config, rand=lambda: 0.5) == 2.0

    def test_試行回数が大きくてもオーバーフローしない(self) -> None:
        config = RetryConfig(base_delay=1.0, max_delay=8.0, jitter=False)
        assert compute_delay(1000, config) == 8.0

    def test_attemptが0以下なら例外(self) -> None:
        with pytest.raises(ValueError, match="attempt"):
            compute_delay(0)


# ── retry_call ────────────────────────────────────────────────────
class TestRetryCall:
    def test_成功時はそのまま返る(self) -> None:
        sleep = RecordingSleep()
        assert retry_call(lambda: {"Vpcs": []}, sleep=sleep) == {"Vpcs": []}
        assert sleep.calls == []

    def test_引数がそのまま渡る(self) -> None:
        func = MagicMock(return_value="ok")
        retry_call(
            func, "positional", Filters=[{"Name": "vpc-id"}], sleep=lambda _: None
        )
        func.assert_called_once_with("positional", Filters=[{"Name": "vpc-id"}])

    def test_スロットリング後に成功する(self) -> None:
        sleep = RecordingSleep()
        func = MagicMock(
            side_effect=[make_client_error("RequestLimitExceeded"), {"Vpcs": [1]}]
        )
        assert retry_call(func, sleep=sleep, rand=lambda: 1.0) == {"Vpcs": [1]}
        assert func.call_count == 2
        assert sleep.calls == [0.5]

    def test_試行回数を使い切ると元の例外が送出される(self) -> None:
        sleep = RecordingSleep()
        error = make_client_error("Throttling")
        func = MagicMock(side_effect=error)
        with pytest.raises(ClientError) as exc_info:
            retry_call(func, sleep=sleep, rand=lambda: 1.0)
        assert exc_info.value is error
        assert func.call_count == DEFAULT_CONFIG.max_attempts
        assert sleep.calls == [0.5, 1.0]

    def test_リトライ不能な例外は即座に送出される(self) -> None:
        sleep = RecordingSleep()
        func = MagicMock(side_effect=make_client_error("AccessDenied"))
        with pytest.raises(ClientError):
            retry_call(func, sleep=sleep)
        assert func.call_count == 1
        assert sleep.calls == []

    def test_独自例外でラップしない(self) -> None:
        """呼び出し側の except ClientError を壊さないことを保証する。"""
        func = MagicMock(side_effect=make_client_error("ValidationError"))
        with pytest.raises(ClientError) as exc_info:
            retry_call(func, sleep=lambda _: None)
        assert extract_error_code(exc_info.value) == "ValidationError"

    def test_max_attempts_1ならリトライしない(self) -> None:
        sleep = RecordingSleep()
        func = MagicMock(side_effect=make_client_error("Throttling"))
        with pytest.raises(ClientError):
            retry_call(func, config=RetryConfig(max_attempts=1), sleep=sleep)
        assert func.call_count == 1
        assert sleep.calls == []

    def test_on_retryが呼ばれる(self) -> None:
        events: list[tuple[int, float, str]] = []
        func = MagicMock(side_effect=[make_client_error("Throttling"), "ok"])
        retry_call(
            func,
            sleep=lambda _: None,
            rand=lambda: 1.0,
            on_retry=lambda attempt, delay, exc: events.append(
                (attempt, delay, extract_error_code(exc))
            ),
        )
        assert events == [(1, 0.5, "Throttling")]

    def test_ネットワーク例外でもリトライする(self) -> None:
        func = MagicMock(
            side_effect=[ConnectTimeoutError(endpoint_url="https://ec2"), "ok"]
        )
        assert retry_call(func, sleep=lambda _: None) == "ok"
        assert func.call_count == 2


# ── with_retry デコレータ ─────────────────────────────────────────
class TestWithRetry:
    def test_デコレータとして動く(self) -> None:
        calls = {"n": 0}

        @with_retry(sleep=lambda _: None, rand=lambda: 1.0)
        def describe() -> str:
            calls["n"] += 1
            if calls["n"] == 1:
                raise make_client_error("Throttling")
            return "ok"

        assert describe() == "ok"
        assert calls["n"] == 2

    def test_メタデータが保持される(self) -> None:
        @with_retry()
        def describe_vpcs() -> None:
            """VPC を取得する。"""

        assert describe_vpcs.__name__ == "describe_vpcs"
        assert describe_vpcs.__doc__ == "VPC を取得する。"
        assert hasattr(describe_vpcs, "__wrapped__")


# ── verify_stack との結合 ─────────────────────────────────────────
class TestVerifyStackIntegration:
    """検証スクリプトの呼び出しが実際にリトライされることを確認する。"""

    def test_describe_vpcsがスロットリングから復帰する(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import retry as retry_module
        import verify_stack

        # 実待機を避ける（リトライ本体のロジックは変えない）
        monkeypatch.setattr(retry_module.time, "sleep", lambda _: None)

        ec2_client = MagicMock()
        ec2_client.describe_vpcs.side_effect = [
            make_client_error("RequestLimitExceeded"),
            {"Vpcs": [{"VpcId": "vpc-123", "CidrBlock": "10.0.0.0/16"}]},
        ]
        ec2_client.describe_subnets.return_value = {"Subnets": [{}] * 6}
        ec2_client.describe_nat_gateways.return_value = {"NatGateways": [{}]}

        assert verify_stack.verify_vpc(ec2_client) == "vpc-123"
        assert ec2_client.describe_vpcs.call_count == 2

    def test_リトライ不能なエラーはそのまま送出される(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import retry as retry_module
        import verify_stack

        monkeypatch.setattr(retry_module.time, "sleep", lambda _: None)

        ec2_client = MagicMock()
        ec2_client.describe_vpcs.side_effect = make_client_error(
            "UnauthorizedOperation"
        )

        with pytest.raises(ClientError):
            verify_stack.verify_vpc(ec2_client)
        assert ec2_client.describe_vpcs.call_count == 1
