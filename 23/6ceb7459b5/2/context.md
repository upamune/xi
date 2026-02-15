# Session Context

## User Prompts

### Prompt 1

Implement the following plan:

# Reasoning 表示 & Tool Call 表示の追加

## Context
前回のストリーミング対応で `textStream` → `onChunk` コールバックを実装済み。
今回は `fullStream` に切り替えて reasoning (思考過程) と tool call をリアルタイム表示する。

## 表示イメージ
```
You:
ファイルの中身を教えて

ʕ·ᴥ·ʔ: ユーザーがファイルの中身を知りたい...    ← reasoning（薄グレー、随時書き換え�...

### Prompt 2

tool call の表示の位置がおかしい。

### Prompt 3

commit

### Prompt 4

[Request interrupted by user for tool use]

