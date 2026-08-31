/**
 * CDK 3-Tier App: デプロイ前設定バリデーター
 *
 * スタック設定の妥当性をデプロイ前に検証する純粋関数群。
 * CDK に依存しないため単体テストが容易。
 *
 * 検証内容:
 *   - VPC CIDR 範囲のフォーマット・プレフィックス長
 *   - インスタンスタイプの許可リスト
 *   - 環境別（dev/prod）の必須設定チェック
 *   - タグコンプライアンス
 *   - サブネット構成の妥当性
 */

// ── 型定義 ────────────────────────────────────────────────────

export type Environment = "dev" | "staging" | "prod";

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface StackConfig {
  environment: Environment;
  vpcCidr: string;
  maxAzs: number;
  natGateways: number;
  instanceType: string;
  rdsInstanceType: string;
  rdsMultiAz: boolean;
  rdsDeletionProtection: boolean;
  rdsBackupRetentionDays: number;
  tags: Record<string, string>;
}

// ── 定数 ─────────────────────────────────────────────────────

/** dev 環境で許可するインスタンスタイプ（コスト最適化） */
export const DEV_ALLOWED_INSTANCE_TYPES = [
  "t3.micro", "t3.small", "t3.medium",
  "t3a.micro", "t3a.small", "t3a.medium",
  "t4g.micro", "t4g.small", "t4g.medium",
] as const;

/** prod 環境で許可するインスタンスタイプ */
export const PROD_ALLOWED_INSTANCE_TYPES = [
  ...DEV_ALLOWED_INSTANCE_TYPES,
  "t3.large", "t3.xlarge",
  "t3a.large", "t3a.xlarge",
  "t4g.large", "t4g.xlarge",
  "m5.large", "m5.xlarge",
  "m6i.large", "m6i.xlarge",
  "m7i.large", "m7i.xlarge",
] as const;

/** 必須タグ */
export const REQUIRED_TAGS = ["Project", "Environment", "ManagedBy"] as const;

/** VPC CIDR の許可プレフィックス長範囲 */
export const MIN_VPC_PREFIX = 16;
export const MAX_VPC_PREFIX = 24;

// ── VPC CIDR バリデーション ────────────────────────────────────

/** CIDR 表記が正しいフォーマットか検証する */
export function isValidCidr(cidr: string): boolean {
  const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return false;

  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  const prefix = Number(match[5]);

  if (octets.some((o) => o > 255)) return false;
  if (prefix < 0 || prefix > 32) return false;

  return true;
}

/** VPC CIDR のプレフィックス長を取得する（不正なら -1） */
export function getCidrPrefix(cidr: string): number {
  if (!isValidCidr(cidr)) return -1;
  return Number(cidr.split("/")[1]);
}

/** VPC CIDR がプライベートアドレス空間（RFC 1918）か検証する */
export function isPrivateCidr(cidr: string): boolean {
  if (!isValidCidr(cidr)) return false;
  const firstOctet = Number(cidr.split(".")[0]);
  const secondOctet = Number(cidr.split(".")[1]);

  // 10.0.0.0/8
  if (firstOctet === 10) return true;
  // 172.16.0.0/12
  if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return true;
  // 192.168.0.0/16
  if (firstOctet === 192 && secondOctet === 168) return true;

  return false;
}

/** VPC CIDR を検証しエラー配列を返す */
export function validateVpcCidr(cidr: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isValidCidr(cidr)) {
    errors.push({ field: "vpcCidr", message: `無効な CIDR 形式: ${cidr}`, severity: "error" });
    return errors;
  }

  if (!isPrivateCidr(cidr)) {
    errors.push({ field: "vpcCidr", message: "VPC CIDR はプライベートアドレス空間（RFC 1918）を使用してください", severity: "error" });
  }

  const prefix = getCidrPrefix(cidr);
  if (prefix < MIN_VPC_PREFIX || prefix > MAX_VPC_PREFIX) {
    errors.push({ field: "vpcCidr", message: `VPC CIDR プレフィックス長は /${MIN_VPC_PREFIX}〜/${MAX_VPC_PREFIX} にしてください（現在: /${prefix}）`, severity: "error" });
  }

  return errors;
}

// ── インスタンスタイプバリデーション ───────────────────────────

/** 環境に応じた許可リストでインスタンスタイプを検証する */
export function isAllowedInstanceType(instanceType: string, env: Environment): boolean {
  const allowed = env === "prod" ? PROD_ALLOWED_INSTANCE_TYPES : DEV_ALLOWED_INSTANCE_TYPES;
  return (allowed as readonly string[]).includes(instanceType);
}

/** インスタンスタイプを検証しエラー配列を返す */
export function validateInstanceType(instanceType: string, env: Environment, field: string): ValidationError[] {
  if (!isAllowedInstanceType(instanceType, env)) {
    return [{
      field,
      message: `${env} 環境で許可されていないインスタンスタイプ: ${instanceType}`,
      severity: "error",
    }];
  }
  return [];
}

// ── 環境別設定バリデーション ──────────────────────────────────

/** prod 環境の必須設定を検証する */
export function validateProdRequirements(config: StackConfig): ValidationError[] {
  if (config.environment !== "prod") return [];

  const errors: ValidationError[] = [];

  if (!config.rdsMultiAz) {
    errors.push({ field: "rdsMultiAz", message: "prod 環境では RDS マルチ AZ を有効にしてください", severity: "error" });
  }
  if (!config.rdsDeletionProtection) {
    errors.push({ field: "rdsDeletionProtection", message: "prod 環境では RDS 削除保護を有効にしてください", severity: "error" });
  }
  if (config.rdsBackupRetentionDays < 7) {
    errors.push({ field: "rdsBackupRetentionDays", message: `prod 環境では RDS バックアップ保持期間を 7 日以上にしてください（現在: ${config.rdsBackupRetentionDays} 日）`, severity: "error" });
  }
  if (config.natGateways < 2) {
    errors.push({ field: "natGateways", message: "prod 環境では NAT Gateway を 2 つ以上（マルチ AZ）にしてください", severity: "warning" });
  }
  if (config.maxAzs < 2) {
    errors.push({ field: "maxAzs", message: "prod 環境では 2 AZ 以上を使用してください", severity: "error" });
  }

  return errors;
}

// ── タグバリデーション ────────────────────────────────────────

/** 必須タグが含まれているか検証する */
export function validateTags(tags: Record<string, string>): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const tag of REQUIRED_TAGS) {
    if (!tags[tag] || tags[tag].trim() === "") {
      errors.push({ field: "tags", message: `必須タグが未設定です: ${tag}`, severity: "error" });
    }
  }
  return errors;
}

// ── サブネット構成バリデーション ──────────────────────────────

/** AZ 数と NAT Gateway 数の整合性を検証する */
export function validateSubnetConfig(maxAzs: number, natGateways: number): ValidationError[] {
  const errors: ValidationError[] = [];

  if (maxAzs < 1 || maxAzs > 3) {
    errors.push({ field: "maxAzs", message: `AZ 数は 1〜3 にしてください（現在: ${maxAzs}）`, severity: "error" });
  }
  if (natGateways < 0) {
    errors.push({ field: "natGateways", message: "NAT Gateway 数は 0 以上にしてください", severity: "error" });
  }
  if (natGateways > maxAzs) {
    errors.push({ field: "natGateways", message: `NAT Gateway 数（${natGateways}）が AZ 数（${maxAzs}）を超えています`, severity: "warning" });
  }

  return errors;
}

// ── 統合バリデーション ────────────────────────────────────────

/** StackConfig 全体を検証しエラー配列を返す */
export function validateStackConfig(config: StackConfig): ValidationError[] {
  return [
    ...validateVpcCidr(config.vpcCidr),
    ...validateSubnetConfig(config.maxAzs, config.natGateways),
    ...validateInstanceType(config.instanceType, config.environment, "instanceType"),
    ...validateInstanceType(config.rdsInstanceType, config.environment, "rdsInstanceType"),
    ...validateProdRequirements(config),
    ...validateTags(config.tags),
  ];
}

/** エラーの有無を判定する（warning は含まない） */
export function hasErrors(errors: ValidationError[]): boolean {
  return errors.some((e) => e.severity === "error");
}

/** エラーをフォーマットして表示用文字列を返す */
export function formatErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return "すべてのチェックが通過しました";
  return errors
    .map((e) => `[${e.severity.toUpperCase()}] ${e.field}: ${e.message}`)
    .join("\n");
}
