"use strict";

import {
  isValidCidr,
  getCidrPrefix,
  isPrivateCidr,
  validateVpcCidr,
  isAllowedInstanceType,
  validateInstanceType,
  validateProdRequirements,
  validateTags,
  validateSubnetConfig,
  validateStackConfig,
  hasErrors,
  formatErrors,
  DEV_ALLOWED_INSTANCE_TYPES,
  PROD_ALLOWED_INSTANCE_TYPES,
  REQUIRED_TAGS,
  MIN_VPC_PREFIX,
  MAX_VPC_PREFIX,
} from "../lib/validators";
import type { StackConfig, ValidationError } from "../lib/validators";

// ── テスト用ヘルパー ─────────────────────────────────────────

const validDevConfig: StackConfig = {
  environment: "dev",
  vpcCidr: "10.0.0.0/16",
  maxAzs: 2,
  natGateways: 1,
  instanceType: "t3.micro",
  rdsInstanceType: "t3.micro",
  rdsMultiAz: false,
  rdsDeletionProtection: false,
  rdsBackupRetentionDays: 7,
  tags: { Project: "cdk-3tier-app", Environment: "dev", ManagedBy: "CDK" },
};

const validProdConfig: StackConfig = {
  ...validDevConfig,
  environment: "prod",
  natGateways: 2,
  rdsMultiAz: true,
  rdsDeletionProtection: true,
  rdsBackupRetentionDays: 14,
  tags: { Project: "cdk-3tier-app", Environment: "prod", ManagedBy: "CDK" },
};

// ── 定数テスト ────────────────────────────────────────────────

describe("constants", () => {
  test("DEV_ALLOWED_INSTANCE_TYPES は t3/t3a/t4g の micro〜medium を含む", () => {
    expect(DEV_ALLOWED_INSTANCE_TYPES).toContain("t3.micro");
    expect(DEV_ALLOWED_INSTANCE_TYPES).toContain("t3a.small");
    expect(DEV_ALLOWED_INSTANCE_TYPES).toContain("t4g.medium");
  });

  test("DEV_ALLOWED_INSTANCE_TYPES に large は含まない", () => {
    const hasLarge = DEV_ALLOWED_INSTANCE_TYPES.some((t) => t.includes("large"));
    expect(hasLarge).toBe(false);
  });

  test("PROD_ALLOWED_INSTANCE_TYPES は DEV の全てを含む", () => {
    for (const t of DEV_ALLOWED_INSTANCE_TYPES) {
      expect(PROD_ALLOWED_INSTANCE_TYPES).toContain(t);
    }
  });

  test("PROD_ALLOWED_INSTANCE_TYPES は m5/m6i/m7i を含む", () => {
    expect(PROD_ALLOWED_INSTANCE_TYPES).toContain("m5.large");
    expect(PROD_ALLOWED_INSTANCE_TYPES).toContain("m6i.xlarge");
    expect(PROD_ALLOWED_INSTANCE_TYPES).toContain("m7i.large");
  });

  test("REQUIRED_TAGS は 3 件", () => {
    expect(REQUIRED_TAGS).toHaveLength(3);
    expect(REQUIRED_TAGS).toContain("Project");
    expect(REQUIRED_TAGS).toContain("Environment");
    expect(REQUIRED_TAGS).toContain("ManagedBy");
  });

  test("VPC プレフィックス範囲は 16〜24", () => {
    expect(MIN_VPC_PREFIX).toBe(16);
    expect(MAX_VPC_PREFIX).toBe(24);
  });
});

// ── isValidCidr ──────────────────────────────────────────────

describe("isValidCidr", () => {
  test("10.0.0.0/16 は有効", () => {
    expect(isValidCidr("10.0.0.0/16")).toBe(true);
  });

  test("192.168.1.0/24 は有効", () => {
    expect(isValidCidr("192.168.1.0/24")).toBe(true);
  });

  test("172.16.0.0/12 は有効", () => {
    expect(isValidCidr("172.16.0.0/12")).toBe(true);
  });

  test("0.0.0.0/0 は有効なCIDR形式", () => {
    expect(isValidCidr("0.0.0.0/0")).toBe(true);
  });

  test("256.0.0.0/16 は無効（オクテット超過）", () => {
    expect(isValidCidr("256.0.0.0/16")).toBe(false);
  });

  test("10.0.0.0/33 は無効（プレフィックス超過）", () => {
    expect(isValidCidr("10.0.0.0/33")).toBe(false);
  });

  test("空文字列は無効", () => {
    expect(isValidCidr("")).toBe(false);
  });

  test("スラッシュなしは無効", () => {
    expect(isValidCidr("10.0.0.0")).toBe(false);
  });

  test("文字列は無効", () => {
    expect(isValidCidr("not-a-cidr")).toBe(false);
  });

  test("255.255.255.255/32 は有効", () => {
    expect(isValidCidr("255.255.255.255/32")).toBe(true);
  });
});

// ── getCidrPrefix ────────────────────────────────────────────

describe("getCidrPrefix", () => {
  test("10.0.0.0/16 のプレフィックスは 16", () => {
    expect(getCidrPrefix("10.0.0.0/16")).toBe(16);
  });

  test("192.168.0.0/24 のプレフィックスは 24", () => {
    expect(getCidrPrefix("192.168.0.0/24")).toBe(24);
  });

  test("無効な CIDR は -1", () => {
    expect(getCidrPrefix("invalid")).toBe(-1);
  });

  test("0.0.0.0/0 のプレフィックスは 0", () => {
    expect(getCidrPrefix("0.0.0.0/0")).toBe(0);
  });
});

// ── isPrivateCidr ────────────────────────────────────────────

describe("isPrivateCidr", () => {
  test("10.x.x.x はプライベート", () => {
    expect(isPrivateCidr("10.0.0.0/16")).toBe(true);
    expect(isPrivateCidr("10.255.0.0/16")).toBe(true);
  });

  test("172.16〜31.x.x はプライベート", () => {
    expect(isPrivateCidr("172.16.0.0/12")).toBe(true);
    expect(isPrivateCidr("172.31.0.0/16")).toBe(true);
  });

  test("172.15.x.x はパブリック", () => {
    expect(isPrivateCidr("172.15.0.0/16")).toBe(false);
  });

  test("172.32.x.x はパブリック", () => {
    expect(isPrivateCidr("172.32.0.0/16")).toBe(false);
  });

  test("192.168.x.x はプライベート", () => {
    expect(isPrivateCidr("192.168.0.0/16")).toBe(true);
    expect(isPrivateCidr("192.168.1.0/24")).toBe(true);
  });

  test("8.8.8.0/24 はパブリック", () => {
    expect(isPrivateCidr("8.8.8.0/24")).toBe(false);
  });

  test("無効な CIDR は false", () => {
    expect(isPrivateCidr("invalid")).toBe(false);
  });
});

// ── validateVpcCidr ──────────────────────────────────────────

describe("validateVpcCidr", () => {
  test("10.0.0.0/16 はエラーなし", () => {
    expect(validateVpcCidr("10.0.0.0/16")).toHaveLength(0);
  });

  test("無効な CIDR は error を返す", () => {
    const errors = validateVpcCidr("invalid");
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe("error");
  });

  test("パブリック CIDR は error を返す", () => {
    const errors = validateVpcCidr("8.8.8.0/16");
    expect(errors.some((e) => e.message.includes("RFC 1918"))).toBe(true);
  });

  test("/8 はプレフィックス長エラー", () => {
    const errors = validateVpcCidr("10.0.0.0/8");
    expect(errors.some((e) => e.message.includes("プレフィックス長"))).toBe(true);
  });

  test("/28 はプレフィックス長エラー", () => {
    const errors = validateVpcCidr("10.0.0.0/28");
    expect(errors.some((e) => e.message.includes("プレフィックス長"))).toBe(true);
  });

  test("10.0.0.0/24 はエラーなし（境界値）", () => {
    expect(validateVpcCidr("10.0.0.0/24")).toHaveLength(0);
  });
});

// ── isAllowedInstanceType ────────────────────────────────────

describe("isAllowedInstanceType", () => {
  test("dev で t3.micro は許可", () => {
    expect(isAllowedInstanceType("t3.micro", "dev")).toBe(true);
  });

  test("dev で m5.large は不許可", () => {
    expect(isAllowedInstanceType("m5.large", "dev")).toBe(false);
  });

  test("prod で m5.large は許可", () => {
    expect(isAllowedInstanceType("m5.large", "prod")).toBe(true);
  });

  test("prod で t3.micro も許可", () => {
    expect(isAllowedInstanceType("t3.micro", "prod")).toBe(true);
  });

  test("dev で t3.xlarge は不許可", () => {
    expect(isAllowedInstanceType("t3.xlarge", "dev")).toBe(false);
  });

  test("prod で t3.xlarge は許可", () => {
    expect(isAllowedInstanceType("t3.xlarge", "prod")).toBe(true);
  });

  test("存在しないインスタンスタイプは不許可", () => {
    expect(isAllowedInstanceType("x1.16xlarge", "prod")).toBe(false);
  });

  test("staging は dev と同じ制限", () => {
    expect(isAllowedInstanceType("t3.micro", "staging")).toBe(true);
    expect(isAllowedInstanceType("m5.large", "staging")).toBe(false);
  });
});

// ── validateInstanceType ─────────────────────────────────────

describe("validateInstanceType", () => {
  test("許可されたタイプはエラーなし", () => {
    expect(validateInstanceType("t3.micro", "dev", "instanceType")).toHaveLength(0);
  });

  test("不許可タイプは error を返す", () => {
    const errors = validateInstanceType("m5.large", "dev", "instanceType");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("instanceType");
    expect(errors[0].severity).toBe("error");
  });

  test("field 名が正しく設定される", () => {
    const errors = validateInstanceType("x1.large", "dev", "rdsInstanceType");
    expect(errors[0].field).toBe("rdsInstanceType");
  });
});

// ── validateProdRequirements ─────────────────────────────────

describe("validateProdRequirements", () => {
  test("dev 環境は空配列を返す", () => {
    expect(validateProdRequirements(validDevConfig)).toHaveLength(0);
  });

  test("正しい prod 設定はエラーなし", () => {
    expect(validateProdRequirements(validProdConfig)).toHaveLength(0);
  });

  test("prod で multiAz=false は error", () => {
    const config = { ...validProdConfig, rdsMultiAz: false };
    const errors = validateProdRequirements(config);
    expect(errors.some((e) => e.field === "rdsMultiAz")).toBe(true);
  });

  test("prod で deletionProtection=false は error", () => {
    const config = { ...validProdConfig, rdsDeletionProtection: false };
    const errors = validateProdRequirements(config);
    expect(errors.some((e) => e.field === "rdsDeletionProtection")).toBe(true);
  });

  test("prod でバックアップ 3 日は error", () => {
    const config = { ...validProdConfig, rdsBackupRetentionDays: 3 };
    const errors = validateProdRequirements(config);
    expect(errors.some((e) => e.field === "rdsBackupRetentionDays")).toBe(true);
  });

  test("prod で NAT Gateway 1 つは warning", () => {
    const config = { ...validProdConfig, natGateways: 1 };
    const errors = validateProdRequirements(config);
    const natErr = errors.find((e) => e.field === "natGateways");
    expect(natErr?.severity).toBe("warning");
  });

  test("prod で maxAzs=1 は error", () => {
    const config = { ...validProdConfig, maxAzs: 1 };
    const errors = validateProdRequirements(config);
    expect(errors.some((e) => e.field === "maxAzs")).toBe(true);
  });

  test("staging 環境は空配列を返す", () => {
    const config = { ...validDevConfig, environment: "staging" as const };
    expect(validateProdRequirements(config)).toHaveLength(0);
  });
});

// ── validateTags ─────────────────────────────────────────────

describe("validateTags", () => {
  test("全タグ設定済みはエラーなし", () => {
    const tags = { Project: "app", Environment: "dev", ManagedBy: "CDK" };
    expect(validateTags(tags)).toHaveLength(0);
  });

  test("Project 未設定は error", () => {
    const tags = { Environment: "dev", ManagedBy: "CDK" };
    const errors = validateTags(tags);
    expect(errors.some((e) => e.message.includes("Project"))).toBe(true);
  });

  test("空文字タグは error", () => {
    const tags = { Project: "", Environment: "dev", ManagedBy: "CDK" };
    expect(validateTags(tags)).toHaveLength(1);
  });

  test("スペースのみのタグは error", () => {
    const tags = { Project: "  ", Environment: "dev", ManagedBy: "CDK" };
    expect(validateTags(tags)).toHaveLength(1);
  });

  test("全タグ未設定は 3 件 error", () => {
    expect(validateTags({})).toHaveLength(3);
  });

  test("追加タグは無視される（エラーにならない）", () => {
    const tags = { Project: "app", Environment: "dev", ManagedBy: "CDK", Extra: "ok" };
    expect(validateTags(tags)).toHaveLength(0);
  });
});

// ── validateSubnetConfig ─────────────────────────────────────

describe("validateSubnetConfig", () => {
  test("maxAzs=2, natGateways=1 はエラーなし", () => {
    expect(validateSubnetConfig(2, 1)).toHaveLength(0);
  });

  test("maxAzs=0 は error", () => {
    const errors = validateSubnetConfig(0, 0);
    expect(errors.some((e) => e.field === "maxAzs")).toBe(true);
  });

  test("maxAzs=4 は error", () => {
    const errors = validateSubnetConfig(4, 1);
    expect(errors.some((e) => e.field === "maxAzs")).toBe(true);
  });

  test("natGateways=-1 は error", () => {
    const errors = validateSubnetConfig(2, -1);
    expect(errors.some((e) => e.field === "natGateways")).toBe(true);
  });

  test("natGateways > maxAzs は warning", () => {
    const errors = validateSubnetConfig(2, 3);
    const natErr = errors.find((e) => e.field === "natGateways");
    expect(natErr?.severity).toBe("warning");
  });

  test("maxAzs=3, natGateways=3 はエラーなし", () => {
    expect(validateSubnetConfig(3, 3)).toHaveLength(0);
  });
});

// ── validateStackConfig ──────────────────────────────────────

describe("validateStackConfig", () => {
  test("有効な dev 設定はエラーなし", () => {
    expect(validateStackConfig(validDevConfig)).toHaveLength(0);
  });

  test("有効な prod 設定はエラーなし", () => {
    expect(validateStackConfig(validProdConfig)).toHaveLength(0);
  });

  test("無効な CIDR を含む設定は error あり", () => {
    const config = { ...validDevConfig, vpcCidr: "invalid" };
    expect(hasErrors(validateStackConfig(config))).toBe(true);
  });

  test("不許可インスタンスタイプを含む設定は error あり", () => {
    const config = { ...validDevConfig, instanceType: "m5.xlarge" };
    expect(hasErrors(validateStackConfig(config))).toBe(true);
  });

  test("タグ未設定を含む設定は error あり", () => {
    const config = { ...validDevConfig, tags: {} };
    expect(hasErrors(validateStackConfig(config))).toBe(true);
  });

  test("prod で全設定不足は複数 error", () => {
    const config: StackConfig = {
      ...validDevConfig,
      environment: "prod",
      tags: { Project: "app", Environment: "prod", ManagedBy: "CDK" },
    };
    const errors = validateStackConfig(config);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── hasErrors ────────────────────────────────────────────────

describe("hasErrors", () => {
  test("空配列は false", () => {
    expect(hasErrors([])).toBe(false);
  });

  test("error があれば true", () => {
    const errors: ValidationError[] = [{ field: "f", message: "m", severity: "error" }];
    expect(hasErrors(errors)).toBe(true);
  });

  test("warning のみは false", () => {
    const errors: ValidationError[] = [{ field: "f", message: "m", severity: "warning" }];
    expect(hasErrors(errors)).toBe(false);
  });

  test("error と warning の混在は true", () => {
    const errors: ValidationError[] = [
      { field: "f1", message: "m1", severity: "warning" },
      { field: "f2", message: "m2", severity: "error" },
    ];
    expect(hasErrors(errors)).toBe(true);
  });
});

// ── formatErrors ─────────────────────────────────────────────

describe("formatErrors", () => {
  test("空配列は成功メッセージ", () => {
    expect(formatErrors([])).toContain("すべてのチェックが通過");
  });

  test("error は [ERROR] プレフィックス", () => {
    const errors: ValidationError[] = [{ field: "vpcCidr", message: "無効", severity: "error" }];
    expect(formatErrors(errors)).toContain("[ERROR]");
  });

  test("warning は [WARNING] プレフィックス", () => {
    const errors: ValidationError[] = [{ field: "nat", message: "少ない", severity: "warning" }];
    expect(formatErrors(errors)).toContain("[WARNING]");
  });

  test("複数エラーは改行で結合", () => {
    const errors: ValidationError[] = [
      { field: "f1", message: "m1", severity: "error" },
      { field: "f2", message: "m2", severity: "warning" },
    ];
    expect(formatErrors(errors).split("\n")).toHaveLength(2);
  });

  test("field 名がフォーマットに含まれる", () => {
    const errors: ValidationError[] = [{ field: "instanceType", message: "不許可", severity: "error" }];
    expect(formatErrors(errors)).toContain("instanceType");
  });
});
