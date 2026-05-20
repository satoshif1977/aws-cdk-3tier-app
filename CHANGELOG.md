# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
