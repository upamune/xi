# Session Context

## User Prompts

### Prompt 1

[Request interrupted by user for tool use]

### Prompt 2

Implement the following plan:

# `xi browse` サブコマンド実装計画

## Context

xiのセッションデータ(`.xi/sessions/*.db`)を手軽に閲覧する手段がない。`xi browse` コマンドでローカルHTTPサーバーを起動し、htmxベースのwebappでセッション一覧・詳細を表示する。

**重要な制約**: 現在のSessionManagerは会話履歴をDBに永続化していない（`_persistEntry()` はno-op）。表示可能なデータは **tool_calls テー�...

