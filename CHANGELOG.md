# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.5.0] - 2026-07-10

### Added
- CDK Assertions 詳細検証テスト 17 件追加（リソース属性・セキュリティ設定・出力値の詳細検証）
- `cdk-nag`（AwsSolutionsChecks）導入・dev 環境向け抑制設定（11 ルール）

### Changed
- `.gitignore`: `coverage/` と `__pycache__/` を追加
- Dependabot: `aws-cdk-lib` / `aws-cdk` / `@types/node` 更新

## [1.4.0] - 2026-06-16

### Changed
- aws-cdk v2.1124.1 → v2.1127.0
- @types/node v25.6.2 → v25.9.3
- ts-jest v29.4.9 → v29.4.11

### CI
- actions/checkout v4 → v6
- actions/setup-node v4 → v6
- CI/CD ブランチ指定を master → main に統一

### Chore
- デフォルトブランチを master → main に変更・master ブランチ削除


## [1.3.0] - 2026-05-27

### Changed
- TypeScript v5.9.3 → v6.0.3 へアップグレード
- `tsconfig.json` に `types: ["node", "jest"]` を追加（TypeScript v6 のグローバル型解決変更に対応）
- aws-cdk-lib v2.250.0 → v2.253.1
- jest v30.3.0 → v30.4.2
- @types/node v24.12.2 → v25.6.2

### CI
- actions/setup-node v4 → v6
- actions/checkout v4 → v6
- actions/github-script v7 → v9

## [1.2.0] - 2026-05-19

### Added
- CONTRIBUTING.md 追加（PR プロセス・スタイルガイド）

## [1.1.0] - 2026-05-13

### Added
- SECURITY.md 追加
- Dependabot 設定追加
- README にトラブルシューティング・ローカル開発テスト方法セクション追加
- CDK デプロイ手順（アカウント ID 設定含む）を README に詳細追加（2026-05-15）

## [1.0.0] - 2026-04-16

### Added
- 初回実装：AWS CDK TypeScript による 3 層 Web アーキテクチャ
  - VPC（パブリック / プライベートサブネット・マルチ AZ）
  - ALB + EC2（Auto Scaling Group）
  - RDS（MySQL・マルチ AZ）
  - CloudWatch 監視・CfnOutput バグ修正
  - GitHub Actions CI（CDK synth / lint）
  - Jest ユニットテスト追加（CDK Assertions 18 項目）
  - デモ GIF 追加（ALB アクセス・EC2 2台・ターゲットグループ healthy）
- アーキテクチャ構成図（draw.io + PNG）
