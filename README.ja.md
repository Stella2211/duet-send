[English](README.md) | 日本語

# duet-send

自分のパソコンから **Claude Duet** のコーディネーターにメッセージを送るためのツールです。

Claude Duet のコーディネーターは、クラウド上の Claude Code セッションとして動いています。Claude Code には `claude -p "メッセージ" --cloud <セッションID>` でクラウドのセッションにメッセージを送る機能がありますが、コーディネーターのセッションIDはときどき変わり、スクリプトの側では新しいIDがわかりません。duet-send は、この小さいけれど地味に困る問題を解決します。

- コーディネーターが、自分の今のセッションIDを Google ドライブの1行だけのファイル `duet-coordinator-session-id.txt` に書いておきます。
- duet-send はそのファイルを読んで、正しいセッションにメッセージを送ります。
- 送信に失敗したとき（IDが古くなったときなど）は、Discord に知らせることもできます。

ビルドスクリプト、Discord ボット、定期実行のジョブ、手元の Claude Code などから、Duet のコーディネーターに仕事を渡すのに使えます。**macOS と Windows** の両方で動きます。

```sh
bun run duet "夜間ビルドが終わりました。テストが3件落ちているので見てください。"
```

## かんたん導入（AIに任せる）

このリポジトリのリンクをAIに渡して、導入を頼んでください。

1. **Claude Duet（メインのチャット）で**：「https://github.com/Stella2211/duet-send の duet-send を設定して」と頼みます。コーディネーターは [DUET_INSTRUCTIONS.md](DUET_INSTRUCTIONS.md) に沿って動きます。Google ドライブにIDのファイルを書く前と、IDがまだ有効かを1時間ごとに確かめる仕組みを作る前に、あなたに確認します。
2. **手元のパソコンの Claude Code で**：「https://github.com/Stella2211/duet-send の duet-send を docs/setup-guide.ja.md に沿って入れて」と頼みます。必要なら Bun を入れ、このリポジトリを取ってきて、送信のリハーサル（dry run）まで行います。

## 手で導入する

[Bun](https://bun.com)、ネイティブ版の [Claude Code](https://code.claude.com/docs/en/setup)（`claude auth login` でサインイン済み）、それに Google Drive for desktop か Google Workspace CLI（`gws`）のどちらかが必要です。

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
bun run duet --dry-run "テスト"   # 宛先と本文を表示するだけで、送りません
bun run duet "テスト"             # 実際に送ります
```

macOS と Windows それぞれの詳しい手順は [導入ガイド](docs/setup-guide.ja.md) にあります。

## 使い方

```sh
bun run duet "メッセージ"
echo "長いメッセージ" | bun run duet
bun run duet --tag "[Discord bot]" "メッセージ"
bun run duet --dry-run "メッセージ"
```

別のフォルダや別のプログラムから呼ぶときは、スクリプトを直接指定します。

```sh
bun /path/to/duet-send/send.ts --tag "[バックアップ]" "バックアップが終わりました"
```

メッセージの先頭には必ずタグが付きます（既定は `[Claude Code]`）。この方法で送ったメッセージは送り主の情報なしで Duet に届くので、どのスクリプトから来たのかをタグで見分けます。

## セッションIDの読み込み先

次の順に探して、最初に見つかったものを使います。

1. `DUET_ID_FILE`：IDファイルのフルパス
2. Google Drive for desktop のフォルダ：**マイドライブ**（`My Drive`）直下の `duet-coordinator-session-id.txt`
3. Google Workspace CLI（`gws`）：自分のマイドライブ直下からファイルを探してダウンロード（`DUET_DRIVE_FILE_ID` があればそれを使います）
4. `DUET_SESSION_ID`：IDそのもの

## 環境変数（すべて任意）

| 変数 | 役割 |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | `duet-coordinator-session-id.txt` の Drive ファイルID。なくても `gws` が名前で探すので任意です。設定すると検索を省きます。 |
| `DUET_ID_FILE` | IDファイルが通常の Drive フォルダにないときのフルパス。 |
| `DUET_SESSION_ID` | 最後の手段として、IDそのものを指定します。 |
| `DUET_TAG` | メッセージの先頭に付ける既定のタグ。既定値は `[Claude Code]` です。 |
| `DUET_DISCORD_WEBHOOK` | 送信に失敗したときに知らせる Discord の Webhook URL。 |
| `DUET_CLAUDE_BIN` | `claude` が PATH にないときの場所。Windows では `claude.exe` を指定します。 |
| `DUET_GWS_BIN` | `gws` が PATH にないときの場所。 |

## 知っておくと良いこと

- あなたのセッションに送れるのはあなた自身の Claude アカウントだけなので、IDファイルはパスワードではありません。それでも自分のドライブに置き、人には共有しないでください。
- Windows では、npm が作る `claude.cmd` を使わずに止まります。`cmd.exe` を通すと本文が壊れたり、コマンドとして実行されたりするおそれがあるためです。ネイティブ版の `claude.exe` を入れてください。
- 本文は8,000文字までです。改行とタブ以外の制御文字は取り除きます。
- 送信はメッセージを届けるだけで、コーディネーターの返事は待ちません。返事は Duet で確認してください。

## ライセンス

[MIT](LICENSE)
