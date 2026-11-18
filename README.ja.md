[English](README.md) | 日本語

# duet-send

自分のパソコンから **Claude Duet** のコーディネーターにメッセージを送るためのツールです。

Claude Duet のコーディネーターは、クラウド上の Claude Code セッションとして動いています。Claude Code には `claude -p "メッセージ" --cloud <セッションID>` でクラウドのセッションにメッセージを送る機能がありますが、コーディネーターのセッションIDはときどき変わり、スクリプトの側では新しいIDがわかりません。duet-send は、この小さいけれど地味に困る問題を解決します。

- コーディネーターが、自分の今のセッションIDを Google ドライブのファイル `duet-coordinator-session-id.txt` の **説明欄** に書いておき、IDが変わるたびに書き換えます。（説明欄を使うのは、Claude の Google ドライブ コネクタがファイルの説明欄は変えられても、本文は変えられないためです。）
- duet-send はその説明欄を読んで、正しいセッションにメッセージを送ります。
- 送信に失敗したとき（IDが古くなったときなど）は、Discord に知らせることもできます。

ビルドスクリプト、Discord ボット、定期実行のジョブ、手元の Claude Code などから、Duet のコーディネーターに仕事を渡すのに使えます。**macOS と Windows** の両方で動きます。

```sh
bun run duet "夜間ビルドが終わりました。テストが3件落ちているので見てください。"
```

## かんたん導入（AIに任せる）

このリポジトリのリンクをAIに渡して、次の順で導入を頼んでください。

1. **Claude Duet（メインのチャット）で**：「https://github.com/Stella2211/duet-send の duet-send を設定して」と頼みます。コーディネーターは [DUET_INSTRUCTIONS.md](DUET_INSTRUCTIONS.md) に沿ってIDのファイルを作ります。Google ドライブに書く前と、IDがまだ有効かを1時間ごとに確かめる仕組みを作る前に、あなたに確認します。
2. **手元のパソコンの Claude Code で**：「https://github.com/Stella2211/duet-send の duet-send を docs/setup-guide.ja.md に沿って入れて」と頼みます。足りないものを入れ、このリポジトリを取ってきて、送信のリハーサル（dry run）まで行います。

## 手で導入する

**まず、IDのファイルが必要です。** Duet のコーディネーターに設定を頼んでください（上の1）。コーディネーターがマイドライブに `duet-coordinator-session-id.txt` を書くまでは、duet-send は読むものがありません。

必要なもの：

- [git](https://git-scm.com/downloads)（なければ、下のように ZIP でダウンロードしても構いません）
- [Bun](https://bun.com)
- ネイティブ版の [Claude Code](https://code.claude.com/docs/en/setup)（`claude auth login` でサインイン済み）
- Google Workspace CLI（`gws`）。IDファイルがある Google アカウントでサインインしておきます

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
bun run duet --dry-run "テスト"   # すべて確認するが、送らない
bun run duet "テスト"             # 実際に送る
```

git がない場合は、リポジトリのページで **Code → Download ZIP** を選び、展開したフォルダでターミナルを開いてください。

macOS と Windows それぞれの詳しい手順（定期実行やトラブルシューティングを含む）は [導入ガイド](docs/setup-guide.ja.md) にあります。

## 使い方

```sh
bun run duet "メッセージ"
echo "長いメッセージ" | bun run duet
bun run duet --tag "[Discord bot]" "メッセージ"
bun run duet --dry-run "メッセージ"
bun run duet --verbose "メッセージ"
```

- `--dry-run` はセッションIDと `claude` を探し、送る内容を表示するだけで、送りません。失敗する場所は実際の送信と同じです。
- `--tag` はメッセージの先頭に付けるラベルです（既定は `[Claude Code]`）。この方法で送ったメッセージは送り主の情報なしで Duet に届くので、どのスクリプトから来たのかをタグで見分けます。
- `--verbose` はセッションIDの全体と、Claude Code 自身の出力を表示します。付けないときは、ログやスクリーンショットに残らないよう、IDを `session_01Ab…xyz` のように短くして表示します。

別のフォルダや別のプログラムから呼ぶときは、スクリプトをフルパスで指定します。

```sh
bun /path/to/duet-send/send.ts --tag "[バックアップ]" "バックアップが終わりました"
```

任意で、duet-send を Claude Code の [Stop hook](https://code.claude.com/docs/ja/hooks#stop) として動かすこともできます（`send.ts --hook`）。手元の Claude Code が応答を終えるたびに、コーディネーターに知らせます。[導入ガイドの手順9](docs/setup-guide.ja.md#9-任意claude-code-が作業を終えたらコーディネーターに知らせるstop-hook) を見てください。

## セッションIDの読み込み先

次の順に探して、最初に見つかったものを使います。

1. Google Workspace CLI（`gws`）：自分のマイドライブ直下からファイルを探し（`DUET_DRIVE_FILE_ID` があればそのファイルを使い）、ファイルの **説明欄** を読みます。説明欄が空のときは、代わりにファイルの本文をダウンロードします。説明欄を使う前に用意したファイルも、そのまま使えます。他人から共有されたファイルは無視します。
2. `DUET_SESSION_ID`：IDそのもの

## 環境変数（すべて任意）

| 変数 | 役割 |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | `duet-coordinator-session-id.txt` の Drive ファイルID。`gws` が名前で探す手間を省き、そのファイルの説明欄を直接読みます。 |
| `DUET_SESSION_ID` | 最後の手段として、IDそのものを指定します。コーディネーターが変わると古くなります。 |
| `DUET_TAG` | メッセージの先頭に付ける既定のタグ。既定値は `[Claude Code]` です。 |
| `DUET_DISCORD_WEBHOOK` | 送信に失敗したときに知らせる Discord の Webhook URL。通知の中のIDは短くして送ります。 |
| `DUET_CLAUDE_BIN` | `claude` のフルパス。Windows では `claude.exe` を指定します。定期実行では設定してください。 |
| `DUET_GWS_BIN` | `gws` のフルパス。定期実行では設定してください。 |
| `DUET_HOOK` | `1` のとき、`--hook` は何もしません。duet-send は自分が起動する `claude` にこれを付けるので、自分の送信で hook が動くことはありません。 |

## 知っておくと良いこと

- あなたのセッションに送れるのはあなた自身の Claude アカウントだけなので、IDファイルはパスワードではありません。それでも自分のドライブに置き、人には共有しないでください。
- Windows では、npm が作る `claude.cmd` を使わずに止まります。`cmd.exe` を通すと本文が壊れたり、コマンドとして実行されたりするおそれがあるためです。ネイティブ版の `claude.exe` を入れてください。
- 本文は8,000文字までです。改行コードは `\n` にそろえ、タブ以外の制御文字は取り除きます。
- 送信はメッセージを届けるだけで、コーディネーターの返事は待ちません。返事は Duet で確認してください。

## ライセンス

[MIT](LICENSE)
