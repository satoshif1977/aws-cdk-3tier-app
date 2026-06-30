// aws-cdk-3tier-app: Go 版スタック検証ツール（Python 版 scripts/verify_stack.py との並置）
//
// Python 版との比較ポイント:
//   - AWS クライアントをインターフェースで抽象化 → モックでユニットテスト可能
//   - VerifyResult 構造体で OK/NG を集計 → テストと本番出力の両方に対応
//   - goroutine を使わずシンプルな逐次処理（PoC・学習用途）
//
// 実行方法:
//
//	go run ./verify_stack/main.go [--profile <プロファイル>] [--region <リージョン>]
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2"
	elbtypes "github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2/types"
	"github.com/aws/aws-sdk-go-v2/service/rds"
)

// ── 期待値定数 ─────────────────────────────────────────────────
const (
	VPCName               = "cdk-3tier-vpc"
	ExpectedCIDR          = "10.0.0.0/16"
	ExpectedSubnetCount   = 6
	ExpectedNATGWCount    = 1
	ExpectedInstanceType  = "t3.micro"
	ExpectedDBEngine      = "mysql"
	ExpectedDBVersion     = "8.0"
	ExpectedBackupDays    = 7
)

// ── 結果型 ────────────────────────────────────────────────────
type Status string

const (
	StatusOK   Status = "OK"
	StatusNG   Status = "NG"
	StatusSkip Status = "SKIP"
)

type ResultItem struct {
	Status  Status
	Message string
}

type VerifyResult struct {
	Section string
	Items   []ResultItem
}

func (r *VerifyResult) add(s Status, msg string) {
	r.Items = append(r.Items, ResultItem{Status: s, Message: msg})
}

func (r *VerifyResult) ok(msg string)   { r.add(StatusOK, msg) }
func (r *VerifyResult) ng(msg string)   { r.add(StatusNG, msg) }
func (r *VerifyResult) skip(msg string) { r.add(StatusSkip, msg) }

func (r *VerifyResult) OKCount() int {
	n := 0
	for _, it := range r.Items {
		if it.Status == StatusOK {
			n++
		}
	}
	return n
}

func (r *VerifyResult) NGCount() int {
	n := 0
	for _, it := range r.Items {
		if it.Status == StatusNG {
			n++
		}
	}
	return n
}

func (r *VerifyResult) print() {
	fmt.Printf("\n%s\n  %s\n%s\n", strings.Repeat("=", 50), r.Section, strings.Repeat("=", 50))
	for _, it := range r.Items {
		switch it.Status {
		case StatusOK:
			fmt.Printf("  [OK]  %s\n", it.Message)
		case StatusNG:
			fmt.Printf("  [NG]  %s\n", it.Message)
		case StatusSkip:
			fmt.Printf("  [--]  %s\n", it.Message)
		}
	}
}

// ── AWS クライアントインターフェース ──────────────────────────
type EC2API interface {
	DescribeVpcs(ctx context.Context, params *ec2.DescribeVpcsInput, optFns ...func(*ec2.Options)) (*ec2.DescribeVpcsOutput, error)
	DescribeSubnets(ctx context.Context, params *ec2.DescribeSubnetsInput, optFns ...func(*ec2.Options)) (*ec2.DescribeSubnetsOutput, error)
	DescribeNatGateways(ctx context.Context, params *ec2.DescribeNatGatewaysInput, optFns ...func(*ec2.Options)) (*ec2.DescribeNatGatewaysOutput, error)
	DescribeInstances(ctx context.Context, params *ec2.DescribeInstancesInput, optFns ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error)
}

type ELBAPI interface {
	DescribeLoadBalancers(ctx context.Context, params *elasticloadbalancingv2.DescribeLoadBalancersInput, optFns ...func(*elasticloadbalancingv2.Options)) (*elasticloadbalancingv2.DescribeLoadBalancersOutput, error)
	DescribeTargetGroups(ctx context.Context, params *elasticloadbalancingv2.DescribeTargetGroupsInput, optFns ...func(*elasticloadbalancingv2.Options)) (*elasticloadbalancingv2.DescribeTargetGroupsOutput, error)
}

type RDSAPI interface {
	DescribeDBInstances(ctx context.Context, params *rds.DescribeDBInstancesInput, optFns ...func(*rds.Options)) (*rds.DescribeDBInstancesOutput, error)
}

// ── VPC 検証 ──────────────────────────────────────────────────
func VerifyVPC(ctx context.Context, client EC2API) (result VerifyResult, vpcID string) {
	result.Section = "VPC"

	out, err := client.DescribeVpcs(ctx, &ec2.DescribeVpcsInput{
		Filters: []ec2types.Filter{
			{Name: aws.String("tag:Name"), Values: []string{VPCName}},
		},
	})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeVpcs エラー: %v", err))
		return result, ""
	}
	if len(out.Vpcs) == 0 {
		result.ng(fmt.Sprintf("VPC '%s' が見つかりません", VPCName))
		return result, ""
	}

	vpc := out.Vpcs[0]
	vpcID = aws.ToString(vpc.VpcId)
	result.ok(fmt.Sprintf("VPC が存在します: %s", vpcID))

	cidr := aws.ToString(vpc.CidrBlock)
	if cidr == ExpectedCIDR {
		result.ok(fmt.Sprintf("CIDR ブロック正常: %s", cidr))
	} else {
		result.ng(fmt.Sprintf("CIDR ブロックが想定外: %s (期待: %s)", cidr, ExpectedCIDR))
	}

	// サブネット数確認
	snOut, err := client.DescribeSubnets(ctx, &ec2.DescribeSubnetsInput{
		Filters: []ec2types.Filter{
			{Name: aws.String("vpc-id"), Values: []string{vpcID}},
		},
	})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeSubnets エラー: %v", err))
	} else if count := len(snOut.Subnets); count >= ExpectedSubnetCount {
		result.ok(fmt.Sprintf("サブネット数正常: %d件（期待: %d件以上）", count, ExpectedSubnetCount))
	} else {
		result.ng(fmt.Sprintf("サブネット数不足: %d件（期待: %d件以上）", count, ExpectedSubnetCount))
	}

	// NAT GW 数確認
	ngOut, err := client.DescribeNatGateways(ctx, &ec2.DescribeNatGatewaysInput{
		Filter: []ec2types.Filter{
			{Name: aws.String("vpc-id"), Values: []string{vpcID}},
			{Name: aws.String("state"), Values: []string{"available"}},
		},
	})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeNatGateways エラー: %v", err))
	} else if count := len(ngOut.NatGateways); count == ExpectedNATGWCount {
		result.ok(fmt.Sprintf("NAT ゲートウェイ数正常: %d件", count))
	} else {
		result.ng(fmt.Sprintf("NAT ゲートウェイ数が想定外: %d件（期待: %d件）", count, ExpectedNATGWCount))
	}

	return result, vpcID
}

// ── ALB 検証 ──────────────────────────────────────────────────
func VerifyALB(ctx context.Context, client ELBAPI, vpcID string) VerifyResult {
	result := VerifyResult{Section: "ALB（Application Load Balancer）"}

	if vpcID == "" {
		result.skip("VPC が未検出のためスキップ")
		return result
	}

	out, err := client.DescribeLoadBalancers(ctx, &elasticloadbalancingv2.DescribeLoadBalancersInput{})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeLoadBalancers エラー: %v", err))
		return result
	}

	var alb *elbtypes.LoadBalancer
	for i := range out.LoadBalancers {
		if aws.ToString(out.LoadBalancers[i].VpcId) == vpcID {
			alb = &out.LoadBalancers[i]
			break
		}
	}
	if alb == nil {
		result.ng(fmt.Sprintf("VPC %s に ALB が見つかりません", vpcID))
		return result
	}

	result.ok(fmt.Sprintf("ALB が存在します: %s", aws.ToString(alb.LoadBalancerName)))

	if alb.Scheme == elbtypes.LoadBalancerSchemeEnumInternetFacing {
		result.ok("ALB スキーム正常: internet-facing")
	} else {
		result.ng(fmt.Sprintf("ALB スキームが想定外: %s (期待: internet-facing)", alb.Scheme))
	}

	tgOut, err := client.DescribeTargetGroups(ctx, &elasticloadbalancingv2.DescribeTargetGroupsInput{
		LoadBalancerArn: alb.LoadBalancerArn,
	})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeTargetGroups エラー: %v", err))
	} else if len(tgOut.TargetGroups) > 0 {
		result.ok(fmt.Sprintf("ターゲットグループが存在します: %s", aws.ToString(tgOut.TargetGroups[0].TargetGroupName)))
	} else {
		result.ng("ターゲットグループが見つかりません")
	}

	return result
}

// ── EC2 検証 ──────────────────────────────────────────────────
func VerifyEC2(ctx context.Context, client EC2API, vpcID string) VerifyResult {
	result := VerifyResult{Section: "EC2"}

	if vpcID == "" {
		result.skip("VPC が未検出のためスキップ")
		return result
	}

	out, err := client.DescribeInstances(ctx, &ec2.DescribeInstancesInput{
		Filters: []ec2types.Filter{
			{Name: aws.String("vpc-id"), Values: []string{vpcID}},
			{Name: aws.String("instance-state-name"), Values: []string{"running", "stopped"}},
		},
	})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeInstances エラー: %v", err))
		return result
	}

	var instances []ec2types.Instance
	for _, r := range out.Reservations {
		instances = append(instances, r.Instances...)
	}

	if len(instances) == 0 {
		result.ng(fmt.Sprintf("VPC %s に EC2 インスタンスが見つかりません", vpcID))
		return result
	}

	result.ok(fmt.Sprintf("EC2 インスタンス数: %d件", len(instances)))
	for _, inst := range instances {
		itype := string(inst.InstanceType)
		iid := aws.ToString(inst.InstanceId)
		state := string(inst.State.Name)
		if itype == ExpectedInstanceType {
			result.ok(fmt.Sprintf("  %s: %s (%s)", iid, itype, state))
		} else {
			result.ng(fmt.Sprintf("  %s: インスタンスタイプが想定外 %s (期待: %s)", iid, itype, ExpectedInstanceType))
		}
	}

	return result
}

// ── RDS 検証 ──────────────────────────────────────────────────
func VerifyRDS(ctx context.Context, client RDSAPI) VerifyResult {
	result := VerifyResult{Section: "RDS"}

	out, err := client.DescribeDBInstances(ctx, &rds.DescribeDBInstancesInput{})
	if err != nil {
		result.ng(fmt.Sprintf("DescribeDBInstances エラー: %v", err))
		return result
	}
	if len(out.DBInstances) == 0 {
		result.ng("RDS インスタンスが見つかりません")
		return result
	}

	inst := out.DBInstances[0]
	result.ok(fmt.Sprintf("RDS インスタンスが存在します: %s", aws.ToString(inst.DBInstanceIdentifier)))

	engine := aws.ToString(inst.Engine)
	version := aws.ToString(inst.EngineVersion)
	if engine == ExpectedDBEngine && strings.HasPrefix(version, ExpectedDBVersion) {
		result.ok(fmt.Sprintf("エンジン正常: %s %s", engine, version))
	} else {
		result.ng(fmt.Sprintf("エンジンが想定外: %s %s (期待: %s %s.x)", engine, version, ExpectedDBEngine, ExpectedDBVersion))
	}

	if aws.ToBool(inst.StorageEncrypted) {
		result.ok("ストレージ暗号化: 有効")
	} else {
		result.ng("ストレージ暗号化: 無効（本番では必須）")
	}

	backup := int(aws.ToInt32(inst.BackupRetentionPeriod))
	if backup >= ExpectedBackupDays {
		result.ok(fmt.Sprintf("バックアップ保持期間: %d日（期待: %d日以上）", backup, ExpectedBackupDays))
	} else {
		result.ng(fmt.Sprintf("バックアップ保持期間不足: %d日（期待: %d日以上）", backup, ExpectedBackupDays))
	}

	result.ok(fmt.Sprintf("インスタンスクラス: %s", aws.ToString(inst.DBInstanceClass)))

	return result
}

// ── メイン ────────────────────────────────────────────────────
func main() {
	profileFlag := flag.String("profile", "", "AWS プロファイル名")
	regionFlag := flag.String("region", "ap-northeast-1", "AWS リージョン")
	flag.Parse()

	ctx := context.Background()

	opts := []func(*config.LoadOptions) error{
		config.WithRegion(*regionFlag),
	}
	if *profileFlag != "" {
		opts = append(opts, config.WithSharedConfigProfile(*profileFlag))
	}

	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ERROR] AWS 設定の読み込みに失敗: %v\n", err)
		os.Exit(1)
	}

	ec2Client := ec2.NewFromConfig(cfg)
	elbClient := elasticloadbalancingv2.NewFromConfig(cfg)
	rdsClient := rds.NewFromConfig(cfg)

	fmt.Printf("\naws-cdk-3tier-app スタック検証")
	fmt.Printf("\nリージョン: %s", *regionFlag)
	if *profileFlag != "" {
		fmt.Printf(" / プロファイル: %s", *profileFlag)
	}

	vpcResult, vpcID := VerifyVPC(ctx, ec2Client)
	albResult := VerifyALB(ctx, elbClient, vpcID)
	ec2Result := VerifyEC2(ctx, ec2Client, vpcID)
	rdsResult := VerifyRDS(ctx, rdsClient)

	totalNG := 0
	for _, r := range []VerifyResult{vpcResult, albResult, ec2Result, rdsResult} {
		r.print()
		totalNG += r.NGCount()
	}

	fmt.Printf("\n%s\n  検証完了（NG: %d件）\n%s\n", strings.Repeat("=", 50), totalNG, strings.Repeat("=", 50))

	if totalNG > 0 {
		os.Exit(1)
	}
}
