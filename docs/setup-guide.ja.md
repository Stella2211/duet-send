[English](setup-guide.md) | 日本語

# duet-send 導入ガイド

macOS または Windows に duet-send を入れる手順です。人が読みながら進めても、Claude Code がユーザーの代わりに進めても良いように書いています。

> **Claude Code へ：** 手順を順番に進め、各手順の最後にある確認を実行してください。ソフトウェアはここに書いた公式のコマンドだけで入れてください。シェルの設定ファイルや環境変数への書き込みと、実際のメッセージの送信（手順6）は、ユーザーの了承を得てから行ってください。セッションIDは、このガイドが指定する場所以外に表示したり保存したりしないでください。

## 全体の仕組み

```
自分のスクリプト / ボット / Claude Code
        │  bun run duet "メッセージ"
        ▼
   duet-send ── 読む ──▶ duet-coordinator-session-id.txt（Google ドライブ）
        │
        │  claude -p "[タグ] メッセージ" --cloud <セッションID>
        ▼
 Claude Duet のコーディネーター（クラウドの Claude Code セッション）
```

ドライブのファイルにはコーディネーター自身が自分のセッションIDを書きます（[DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md) を参照）。duet-send はそれを読むだけです。

## 0. 始める前に

- まず Duet のコーディネーターに、このリポジトリのリンクを渡して設定してもらってください。終わると、マイドライブ直下に `duet-coordinator-session-id.txt` ができ、コーディネーターがそのファイルの Drive ファイルIDを教えてくれます（任意。使えるのは `gws` の場合だけです）。
- Claude Code とクラウドセッションが使えるプランが必要です（Pro、Max、Team、または対応する席の Enterprise）。`--cloud` での送信には Claude アカウントでのサインインが必要で、APIキーだけの場合や、Amazon Bedrock・Google Vertex AI などの外部プロバイダー経由では使えません。

## 1. Bun を入れる

macOS：

```sh
curl -fsSL https://bun.com/install | bash
```

Windows（PowerShell。Windows 10 バージョン1809以降）：

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

新しいターミナルを開いて確認します。

```sh
bun --version
```

## 2. Claude Code（ネイティブ版）を入れてサインインする

`claude --version` がすでに動くなら入れ直しは不要です。ただし Windows の方は下の注意を読んでください。

macOS：

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Windows（PowerShell）：

```powershell
irm https://claude.ai/install.ps1 | iex
```

続けて、Claude Duet と同じ Claude アカウントでサインインします。

```sh
claude auth login
claude --version
```

**Windows での注意。** duet-send にはネイティブ版の `claude.exe` が必要です。npm 版（`npm install -g @anthropic-ai/claude-code`）は PATH に `claude.cmd` という起動用ファイルを置きますが、duet-send はこれを使わずに止まります。`cmd.exe` を通すと本文が壊れたり、コマンドとして実行されたりするおそれがあるためです。`claude` がどれを指しているか確認してください。

```powershell
where.exe claude
```

1行目が `.cmd` で終わっていたら、上の方法でネイティブ版を入れるか、`DUET_CLAUDE_BIN` に `claude.exe` のフルパスを設定してください（ネイティブ版のインストーラーは `%USERPROFILE%\.local\bin\claude.exe` に置きます）。

## 3. IDファイルを読む方法を用意する

どちらか **ひとつ** を選びます。

### 方法A：Google Drive for desktop（おすすめ）

[Google Drive for desktop](https://www.google.com/drive/download/) を入れて、IDファイルがある Google アカウントでサインインします。「ストリーミング」と「ミラーリング」のどちらでも動きます。

duet-send は次の場所を自動で探します。

- macOS：`~/Library/CloudStorage/GoogleDrive-*/マイドライブ/`（または `My Drive/`）
- Windows：`G:\マイドライブ\`（または `My Drive\`）。ドライブ文字を変えている場合は D〜Z を順に探します

ドライブのフォルダが別の場所にあるときは、`DUET_ID_FILE` にファイルのフルパスを設定してください（手順5）。

macOS では、ターミナルが初めてドライブのフォルダを読むときに「Google Drive のファイルへのアクセスを許可しますか」と聞かれることがあります。許可してください。

### 方法B：Google Workspace CLI（`gws`）

Drive for desktop がないパソコン向けです。`gws` は GitHub の googleworkspace オーガニゼーションが公開しているオープンソースのツールで、README には Google の公式サポート製品ではないと書かれています。まだ v1.0 前の段階です。

```sh
npm install -g @googleworkspace/cli    # macOS では brew install googleworkspace-cli でも可
gws auth setup                         # 初回のみ。gcloud CLI を使うか、Cloud Console で OAuth を手動設定
gws auth login -s drive
```

`drive` スコープはドライブ全体を読み書きできる権限なので注意してください。

設定はこれだけです。duet-send は自分のマイドライブ直下から `duet-coordinator-session-id.txt` を探してダウンロードします（他人から共有されたファイルは無視します）。`DUET_DRIVE_FILE_ID`（手順5）を設定すると、検索を省いてそのファイルを直接ダウンロードします。

`gws` からファイルが見えるか確かめるには、次を実行します。

```sh
gws drive files list --params "{\"q\":\"name = 'duet-coordinator-session-id.txt' and trashed = false\"}"
```

PowerShell 7.3 以降では次のように書きます。

```powershell
gws drive files list --params '{"q":"name = ''duet-coordinator-session-id.txt'' and trashed = false"}'
```

古い Windows PowerShell 5.1 では内側のダブルクォートが消えてしまうので、`"` をそれぞれ `\"` にエスケープしてください。

ファイルが1件、`id` 付きで表示されれば成功です。`gws` がエラーを出す場合は duet-send も同じエラーを表示するので、先にそれを直してください（多くは `gws auth login -s drive` のやり直しで直ります）。

## 4. duet-send を取ってくる

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
```

duet-send は実行時に依存パッケージを使いません。`bun install` は任意で、エディタ用の型定義が入るだけです。

スクリプトがビルドできるか確認します。

```sh
bun run check
```

## 5. 環境変数を設定する（必要なものだけ）

| 変数 | 必要になるとき |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | 方法B（`gws`）で、名前での検索を省きたいとき |
| `DUET_ID_FILE` | IDファイルが通常のドライブのフォルダにないとき |
| `DUET_DISCORD_WEBHOOK` | 送信に失敗したら Discord に知らせてほしいとき |
| `DUET_TAG` | 既定のタグを `[Claude Code]` 以外にしたいとき |
| `DUET_CLAUDE_BIN` / `DUET_GWS_BIN` | `claude` / `gws` が PATH にないとき |
| `DUET_SESSION_ID` | 最後の手段。IDそのもの（コーディネーターが変わると古くなります） |

macOS（zsh）：`~/.zshrc` に次のような行を足して、新しいターミナルを開きます。

```sh
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows：PowerShell で次を実行して、新しいターミナルを開きます。

```powershell
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 6. 動作を確認する

まずは送らずに試します。IDを探して、宛先と本文を表示するだけです。

```sh
bun run duet --dry-run "duet-send のテスト"
```

`to: session_...`、`read from: ...`、タグ付きの本文が表示されれば成功です。エラーが出たら、下のトラブルシューティングを見てください。

次に、実際にテストのメッセージを送ります（Claude Code はユーザーに確認してから）。

```sh
bun run duet "duet-send のテストです。届いたらチャットで返事をください。"
```

`duet: sent` と出れば、Claude Code がメッセージを届けています。返事は Duet のチャットで確認してください。

## 7. 自分のスクリプトから使う

スクリプトをフルパスで呼び、誰が送ったかわかるタグを付けます。

```sh
bun /path/to/duet-send/send.ts --tag "[夜間ビルド]" "main のビルドが失敗しました"
```

Node や Bun のプログラムから呼ぶときは、シェルのコマンド文字列を組み立てずに、本文を引数として渡してください。

```ts
import { execFile } from "node:child_process";
execFile("bun", ["/path/to/duet-send/send.ts", "--tag", "[Discord bot]", message]);
```

本文が `-` で始まるかもしれないときは、前に `--` を置きます：`bun run duet -- "-5件のテストが失敗"`。（タグが必ず先頭に付くので、`claude` に本文がオプションとして読まれることはありません。）

## トラブルシューティング

**`duet-coordinator-session-id.txt was not found`**
Drive for desktop が起動していない、サインインしていない、またはフォルダが別の場所にあります。ブラウザでマイドライブにファイルがあるか確認し、同期を待つか、`DUET_ID_FILE` にフルパスを設定してください。`gws` を使う場合は、このメッセージの上に出ている `gws` のエラーを見てください。

**`... does not contain a session id`**
ファイルの中身は、`session_`（または `cse_`）で始まる1行だけでなければいけません。コーディネーターに書き直してもらってください。

**`cloud session <id> is archived and cannot accept new messages` または `Session not found`**
コーディネーターが入れ替わったのに、ファイルが古いIDのままです。Duet を開いて何か話しかけてください。新しいコーディネーターは起動時に自分のIDを確認し、ファイルを書き換える前にあなたに確認します。1時間ごとの確認を設定している場合は、1時間ほどで自動的に直ります。`DUET_SESSION_ID` を使っている場合は、その値を更新してください。

**`Unable to get organization UUID`、または「Cloud sessions need a claude.ai sign-in」**
`claude auth login` で Claude アカウントにサインインしてください。APIキーだけでは使えません。

**`Cloud sessions are disabled by your organization's policy`**
Team や Enterprise のプランでは、組織のオーナーが Claude Code の管理設定でクラウドセッションを許可する必要があります。

**`claude.cmd is a .cmd file and cannot be called safely`（Windows）**
手順2の Windows での注意を見てください。

**`claude was not found`**
インストール後に新しいターミナルを開くか、`DUET_CLAUDE_BIN` にフルパスを設定してください。

**`gws could not search Drive` または `gws could not download the file`**
行の後半は `gws` 自身のエラーです。`error[auth]` や `401` なら、`gws auth login -s drive` をもう一度実行してください。

**`gws found no duet-coordinator-session-id.txt in the root of your My Drive`**
ファイルがない、サブフォルダにある、または別のアカウントが持ち主になっています。コーディネーターにマイドライブ直下へ作ってもらうか、`DUET_DRIVE_FILE_ID` を設定してください。

**`found 2 files named duet-coordinator-session-id.txt`**
duet-send は一番新しいものを使います。古いものをドライブから削除するか、`DUET_DRIVE_FILE_ID` を設定してください。

**`duet: sent` と出たのに Duet に届かない**
`claude` が Duet と同じ Claude アカウントでサインインしているか（`claude auth status`）と、ファイルのIDがコーディネーターの今のIDか（コーディネーターに聞いてください）を確認してください。
