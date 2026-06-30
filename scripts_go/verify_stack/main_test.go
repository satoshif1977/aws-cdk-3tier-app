package main

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2"
	elbtypes "github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2/types"
	"github.com/aws/aws-sdk-go-v2/service/rds"
	rdstypes "github.com/aws/aws-sdk-go-v2/service/rds/types"
)

// ── モック ────────────────────────────────────────────────────
type mockEC2 struct {
	vpcs        []ec2types.Vpc
	subnets     []ec2types.Subnet
	natGWs      []ec2types.NatGateway
	reservations []ec2types.Reservation
	err         error
}

func (m *mockEC2) DescribeVpcs(_ context.Context, _ *ec2.DescribeVpcsInput, _ ...func(*ec2.Options)) (*ec2.DescribeVpcsOutput, error) {
	return &ec2.DescribeVpcsOutput{Vpcs: m.vpcs}, m.err
}
func (m *mockEC2) DescribeSubnets(_ context.Context, _ *ec2.DescribeSubnetsInput, _ ...func(*ec2.Options)) (*ec2.DescribeSubnetsOutput, error) {
	return &ec2.DescribeSubnetsOutput{Subnets: m.subnets}, m.err
}
func (m *mockEC2) DescribeNatGateways(_ context.Context, _ *ec2.DescribeNatGatewaysInput, _ ...func(*ec2.Options)) (*ec2.DescribeNatGatewaysOutput, error) {
	return &ec2.DescribeNatGatewaysOutput{NatGateways: m.natGWs}, m.err
}
func (m *mockEC2) DescribeInstances(_ context.Context, _ *ec2.DescribeInstancesInput, _ ...func(*ec2.Options)) (*ec2.DescribeInstancesOutput, error) {
	return &ec2.DescribeInstancesOutput{Reservations: m.reservations}, m.err
}

type mockELB struct {
	lbs []elbtypes.LoadBalancer
	tgs []elbtypes.TargetGroup
	err error
}

func (m *mockELB) DescribeLoadBalancers(_ context.Context, _ *elasticloadbalancingv2.DescribeLoadBalancersInput, _ ...func(*elasticloadbalancingv2.Options)) (*elasticloadbalancingv2.DescribeLoadBalancersOutput, error) {
	return &elasticloadbalancingv2.DescribeLoadBalancersOutput{LoadBalancers: m.lbs}, m.err
}
func (m *mockELB) DescribeTargetGroups(_ context.Context, _ *elasticloadbalancingv2.DescribeTargetGroupsInput, _ ...func(*elasticloadbalancingv2.Options)) (*elasticloadbalancingv2.DescribeTargetGroupsOutput, error) {
	return &elasticloadbalancingv2.DescribeTargetGroupsOutput{TargetGroups: m.tgs}, m.err
}

type mockRDS struct {
	instances []rdstypes.DBInstance
	err       error
}

func (m *mockRDS) DescribeDBInstances(_ context.Context, _ *rds.DescribeDBInstancesInput, _ ...func(*rds.Options)) (*rds.DescribeDBInstancesOutput, error) {
	return &rds.DescribeDBInstancesOutput{DBInstances: m.instances}, m.err
}

// ── ヘルパー ──────────────────────────────────────────────────
func makeVPC(id, cidr string) ec2types.Vpc {
	return ec2types.Vpc{
		VpcId:     aws.String(id),
		CidrBlock: aws.String(cidr),
	}
}

func makeSubnets(n int) []ec2types.Subnet {
	sn := make([]ec2types.Subnet, n)
	for i := range sn {
		sn[i] = ec2types.Subnet{SubnetId: aws.String("subnet-" + string(rune('a'+i)))}
	}
	return sn
}

func makeNATGWs(n int) []ec2types.NatGateway {
	gws := make([]ec2types.NatGateway, n)
	for i := range gws {
		gws[i] = ec2types.NatGateway{NatGatewayId: aws.String("nat-0000")}
	}
	return gws
}

func makeInstance(id, itype string) ec2types.Instance {
	return ec2types.Instance{
		InstanceId:   aws.String(id),
		InstanceType: ec2types.InstanceType(itype),
		State:        &ec2types.InstanceState{Name: ec2types.InstanceStateNameRunning},
	}
}

func makeRDSInstance(engine, version string, encrypted bool, backupDays int32) rdstypes.DBInstance {
	return rdstypes.DBInstance{
		DBInstanceIdentifier: aws.String("mydb"),
		Engine:               aws.String(engine),
		EngineVersion:        aws.String(version),
		StorageEncrypted:     aws.Bool(encrypted),
		BackupRetentionPeriod: aws.Int32(backupDays),
		DBInstanceClass:      aws.String("db.t3.micro"),
	}
}

func hasNG(result VerifyResult) bool { return result.NGCount() > 0 }
func hasOK(result VerifyResult) bool { return result.OKCount() > 0 }

// ── VerifyVPC テスト ──────────────────────────────────────────
func TestVerifyVPC_Success(t *testing.T) {
	m := &mockEC2{
		vpcs:    []ec2types.Vpc{makeVPC("vpc-123", ExpectedCIDR)},
		subnets: makeSubnets(ExpectedSubnetCount),
		natGWs:  makeNATGWs(ExpectedNATGWCount),
	}
	result, vpcID := VerifyVPC(context.Background(), m)
	if hasNG(result) {
		t.Errorf("NG が発生: %+v", result.Items)
	}
	if vpcID != "vpc-123" {
		t.Errorf("vpcID: want vpc-123, got %s", vpcID)
	}
}

func TestVerifyVPC_NotFound(t *testing.T) {
	m := &mockEC2{vpcs: []ec2types.Vpc{}}
	result, vpcID := VerifyVPC(context.Background(), m)
	if !hasNG(result) {
		t.Error("VPC が見つからない場合は NG のはず")
	}
	if vpcID != "" {
		t.Errorf("vpcID: want empty, got %s", vpcID)
	}
}

func TestVerifyVPC_WrongCIDR(t *testing.T) {
	m := &mockEC2{
		vpcs:    []ec2types.Vpc{makeVPC("vpc-999", "192.168.0.0/16")},
		subnets: makeSubnets(ExpectedSubnetCount),
		natGWs:  makeNATGWs(ExpectedNATGWCount),
	}
	result, _ := VerifyVPC(context.Background(), m)
	ngFound := false
	for _, it := range result.Items {
		if it.Status == StatusNG && it.Message != "" {
			ngFound = true
		}
	}
	if !ngFound {
		t.Error("CIDR 不一致の場合は NG のはず")
	}
}

func TestVerifyVPC_InsufficientSubnets(t *testing.T) {
	m := &mockEC2{
		vpcs:    []ec2types.Vpc{makeVPC("vpc-123", ExpectedCIDR)},
		subnets: makeSubnets(3), // 6件未満
		natGWs:  makeNATGWs(ExpectedNATGWCount),
	}
	result, _ := VerifyVPC(context.Background(), m)
	if !hasNG(result) {
		t.Error("サブネット数不足の場合は NG のはず")
	}
}

func TestVerifyVPC_SufficientSubnets(t *testing.T) {
	m := &mockEC2{
		vpcs:    []ec2types.Vpc{makeVPC("vpc-123", ExpectedCIDR)},
		subnets: makeSubnets(6),
		natGWs:  makeNATGWs(1),
	}
	result, _ := VerifyVPC(context.Background(), m)
	// サブネット数 OK の項目が含まれるはず
	found := false
	for _, it := range result.Items {
		if it.Status == StatusOK && len(it.Message) > 0 {
			found = true
		}
	}
	if !found {
		t.Error("OK 項目がない")
	}
}

func TestVerifyVPC_WrongNATGWCount(t *testing.T) {
	m := &mockEC2{
		vpcs:    []ec2types.Vpc{makeVPC("vpc-123", ExpectedCIDR)},
		subnets: makeSubnets(ExpectedSubnetCount),
		natGWs:  makeNATGWs(2), // 期待は1
	}
	result, _ := VerifyVPC(context.Background(), m)
	if !hasNG(result) {
		t.Error("NAT GW 数不一致は NG のはず")
	}
}

func TestVerifyVPC_APIError(t *testing.T) {
	m := &mockEC2{err: errors.New("API エラー")}
	result, vpcID := VerifyVPC(context.Background(), m)
	if !hasNG(result) {
		t.Error("API エラー時は NG のはず")
	}
	if vpcID != "" {
		t.Error("エラー時は vpcID が空のはず")
	}
}

func TestVerifyVPC_ExtraSubnets(t *testing.T) {
	// サブネット数が期待値より多くても OK
	m := &mockEC2{
		vpcs:    []ec2types.Vpc{makeVPC("vpc-123", ExpectedCIDR)},
		subnets: makeSubnets(8),
		natGWs:  makeNATGWs(1),
	}
	result, _ := VerifyVPC(context.Background(), m)
	if result.NGCount() > 1 { // CIDRと他で NG は出ない
		t.Errorf("サブネット過多で余分な NG が出た: %+v", result.Items)
	}
}

// ── VerifyALB テスト ──────────────────────────────────────────
func TestVerifyALB_Success(t *testing.T) {
	m := &mockELB{
		lbs: []elbtypes.LoadBalancer{{
			LoadBalancerArn:  aws.String("arn:alb"),
			LoadBalancerName: aws.String("my-alb"),
			VpcId:            aws.String("vpc-123"),
			Scheme:           elbtypes.LoadBalancerSchemeEnumInternetFacing,
		}},
		tgs: []elbtypes.TargetGroup{{TargetGroupName: aws.String("my-tg")}},
	}
	result := VerifyALB(context.Background(), m, "vpc-123")
	if hasNG(result) {
		t.Errorf("NG が発生: %+v", result.Items)
	}
}

func TestVerifyALB_EmptyVPCID(t *testing.T) {
	m := &mockELB{}
	result := VerifyALB(context.Background(), m, "")
	// スキップになるはず
	skipped := false
	for _, it := range result.Items {
		if it.Status == StatusSkip {
			skipped = true
		}
	}
	if !skipped {
		t.Error("vpcID が空のとき SKIP のはず")
	}
}

func TestVerifyALB_NotFound(t *testing.T) {
	m := &mockELB{
		lbs: []elbtypes.LoadBalancer{{ // 別 VPC の ALB
			VpcId:  aws.String("vpc-999"),
			Scheme: elbtypes.LoadBalancerSchemeEnumInternetFacing,
		}},
	}
	result := VerifyALB(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("ALB が見つからない場合は NG のはず")
	}
}

func TestVerifyALB_WrongScheme(t *testing.T) {
	m := &mockELB{
		lbs: []elbtypes.LoadBalancer{{
			LoadBalancerArn:  aws.String("arn:alb"),
			LoadBalancerName: aws.String("my-alb"),
			VpcId:            aws.String("vpc-123"),
			Scheme:           elbtypes.LoadBalancerSchemeEnumInternal,
		}},
		tgs: []elbtypes.TargetGroup{{TargetGroupName: aws.String("my-tg")}},
	}
	result := VerifyALB(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("internal スキームは NG のはず")
	}
}

func TestVerifyALB_NoTargetGroup(t *testing.T) {
	m := &mockELB{
		lbs: []elbtypes.LoadBalancer{{
			LoadBalancerArn:  aws.String("arn:alb"),
			LoadBalancerName: aws.String("my-alb"),
			VpcId:            aws.String("vpc-123"),
			Scheme:           elbtypes.LoadBalancerSchemeEnumInternetFacing,
		}},
		tgs: []elbtypes.TargetGroup{},
	}
	result := VerifyALB(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("ターゲットグループなしは NG のはず")
	}
}

func TestVerifyALB_APIError(t *testing.T) {
	m := &mockELB{err: errors.New("ELB エラー")}
	result := VerifyALB(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("API エラー時は NG のはず")
	}
}

// ── VerifyEC2 テスト ──────────────────────────────────────────
func TestVerifyEC2_Success(t *testing.T) {
	m := &mockEC2{
		reservations: []ec2types.Reservation{
			{Instances: []ec2types.Instance{makeInstance("i-001", ExpectedInstanceType)}},
		},
	}
	result := VerifyEC2(context.Background(), m, "vpc-123")
	if hasNG(result) {
		t.Errorf("NG が発生: %+v", result.Items)
	}
}

func TestVerifyEC2_EmptyVPCID(t *testing.T) {
	m := &mockEC2{}
	result := VerifyEC2(context.Background(), m, "")
	skipped := false
	for _, it := range result.Items {
		if it.Status == StatusSkip {
			skipped = true
		}
	}
	if !skipped {
		t.Error("vpcID が空のとき SKIP のはず")
	}
}

func TestVerifyEC2_NoInstances(t *testing.T) {
	m := &mockEC2{reservations: []ec2types.Reservation{}}
	result := VerifyEC2(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("インスタンスなしは NG のはず")
	}
}

func TestVerifyEC2_WrongInstanceType(t *testing.T) {
	m := &mockEC2{
		reservations: []ec2types.Reservation{
			{Instances: []ec2types.Instance{makeInstance("i-001", "m5.large")}},
		},
	}
	result := VerifyEC2(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("インスタンスタイプ不一致は NG のはず")
	}
}

func TestVerifyEC2_MultipleInstances(t *testing.T) {
	m := &mockEC2{
		reservations: []ec2types.Reservation{
			{Instances: []ec2types.Instance{
				makeInstance("i-001", ExpectedInstanceType),
				makeInstance("i-002", ExpectedInstanceType),
			}},
		},
	}
	result := VerifyEC2(context.Background(), m, "vpc-123")
	if hasNG(result) {
		t.Errorf("t3.micro 複数は OK のはず: %+v", result.Items)
	}
}

func TestVerifyEC2_MixedInstanceTypes(t *testing.T) {
	m := &mockEC2{
		reservations: []ec2types.Reservation{
			{Instances: []ec2types.Instance{
				makeInstance("i-001", ExpectedInstanceType),
				makeInstance("i-002", "m5.large"), // NG
			}},
		},
	}
	result := VerifyEC2(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("想定外インスタンスタイプ混在は NG のはず")
	}
	if !hasOK(result) {
		t.Error("正常インスタンスの OK もあるはず")
	}
}

func TestVerifyEC2_APIError(t *testing.T) {
	m := &mockEC2{err: errors.New("EC2 エラー")}
	result := VerifyEC2(context.Background(), m, "vpc-123")
	if !hasNG(result) {
		t.Error("API エラー時は NG のはず")
	}
}

// ── VerifyRDS テスト ──────────────────────────────────────────
func TestVerifyRDS_Success(t *testing.T) {
	m := &mockRDS{
		instances: []rdstypes.DBInstance{makeRDSInstance("mysql", "8.0.32", true, 7)},
	}
	result := VerifyRDS(context.Background(), m)
	if hasNG(result) {
		t.Errorf("NG が発生: %+v", result.Items)
	}
}

func TestVerifyRDS_NoInstances(t *testing.T) {
	m := &mockRDS{instances: []rdstypes.DBInstance{}}
	result := VerifyRDS(context.Background(), m)
	if !hasNG(result) {
		t.Error("インスタンスなしは NG のはず")
	}
}

func TestVerifyRDS_WrongEngine(t *testing.T) {
	m := &mockRDS{
		instances: []rdstypes.DBInstance{makeRDSInstance("postgres", "15.0", true, 7)},
	}
	result := VerifyRDS(context.Background(), m)
	if !hasNG(result) {
		t.Error("エンジン不一致は NG のはず")
	}
}

func TestVerifyRDS_WrongVersion(t *testing.T) {
	m := &mockRDS{
		instances: []rdstypes.DBInstance{makeRDSInstance("mysql", "5.7.40", true, 7)},
	}
	result := VerifyRDS(context.Background(), m)
	if !hasNG(result) {
		t.Error("バージョン不一致は NG のはず")
	}
}

func TestVerifyRDS_NotEncrypted(t *testing.T) {
	m := &mockRDS{
		instances: []rdstypes.DBInstance{makeRDSInstance("mysql", "8.0.32", false, 7)},
	}
	result := VerifyRDS(context.Background(), m)
	if !hasNG(result) {
		t.Error("暗号化無効は NG のはず")
	}
}

func TestVerifyRDS_InsufficientBackup(t *testing.T) {
	m := &mockRDS{
		instances: []rdstypes.DBInstance{makeRDSInstance("mysql", "8.0.32", true, 3)},
	}
	result := VerifyRDS(context.Background(), m)
	if !hasNG(result) {
		t.Error("バックアップ保持期間不足は NG のはず")
	}
}

func TestVerifyRDS_SufficientBackup(t *testing.T) {
	m := &mockRDS{
		instances: []rdstypes.DBInstance{makeRDSInstance("mysql", "8.0.32", true, 14)},
	}
	result := VerifyRDS(context.Background(), m)
	if hasNG(result) {
		t.Errorf("バックアップ 14日は OK のはず: %+v", result.Items)
	}
}

func TestVerifyRDS_APIError(t *testing.T) {
	m := &mockRDS{err: errors.New("RDS エラー")}
	result := VerifyRDS(context.Background(), m)
	if !hasNG(result) {
		t.Error("API エラー時は NG のはず")
	}
}

// ── VerifyResult ヘルパーテスト ───────────────────────────────
func TestVerifyResult_OKNGCount(t *testing.T) {
	r := VerifyResult{Section: "テスト"}
	r.ok("成功1")
	r.ok("成功2")
	r.ng("失敗1")
	r.skip("スキップ1")

	if r.OKCount() != 2 {
		t.Errorf("OKCount: want 2, got %d", r.OKCount())
	}
	if r.NGCount() != 1 {
		t.Errorf("NGCount: want 1, got %d", r.NGCount())
	}
}

func TestVerifyResult_EmptyResult(t *testing.T) {
	r := VerifyResult{Section: "空"}
	if r.OKCount() != 0 || r.NGCount() != 0 {
		t.Error("空の結果は OK/NG とも 0 のはず")
	}
}
