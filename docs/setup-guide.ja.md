[English](setup-guide.md) | 日本語

# duet-send 導入ガイド

macOS または Windows に duet-send を入れる手順です。人が読みながら進めても、Claude Code がユーザーの代わりに進めても良いように書いています。

> **Claude Code へ：** 手順を順番に進め、各手順の最後にある確認を実行してください。ソフトウェアはここに書いた公式のコマンドだけで入れてください。シェルの設定ファイルや環境変数への書き込み、実際のメッセージの送信（手順7）、Claude Code の設定ファイルの編集（任意の手順9）は、ユーザーの了承を得てから行ってください。duet-send は出力の中のセッションIDを短くして表示します。`--verbose` を付けて実行せず、セッションIDの全体を表示・コピー・保存しないでください。

## 全体の仕組み

```
自分のスクリプト / ボット / Claude Code
        │  bun run duet "メッセージ"
        ▼
   duet-send ── 読む ──▶ duet-coordinator-session-id.txt の説明欄（Google ドライブ）
        │
        │  claude -p "[タグ] メッセージ" --cloud <セッションID>
        ▼
 Claude Duet のコーディネーター（クラウドの Claude Code セッション）
```

コーディネーター自身が、ドライブのファイルの **説明欄**（ドライブでファイルの詳細を開くと出る「説明」）に自分のセッションIDを書き、IDが変わるたびに書き換えます（[DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md) を参照）。説明欄を使うのは、Claude の Google ドライブ コネクタがファイルの説明欄は変えられても、本文は変えられないためです。duet-send はそれを読むだけです。本文にだけIDが入った以前のファイルも使えます。説明欄が空のときは、duet-send は本文を読みます。

## 0. 始める前に

- **先にIDのファイルが必要です。** Duet のコーディネーターにこのリポジトリのリンクを渡して、duet-send の設定を頼んでください。終わると、マイドライブ直下に `duet-coordinator-session-id.txt` ができます。コーディネーターはそのファイルの Drive ファイルIDも教えてくれます。なくても動きますが、`gws` で探すときに少し速くなります。
- Claude Code とクラウドセッションが使えるプランが必要です（Pro、Max、Team、または対応する席の Enterprise）。`--cloud` での送信には Claude アカウントでのサインインが必要で、APIキーだけの場合や、Amazon Bedrock・Google Vertex AI などの外部プロバイダー経由では使えません。
- 以下の手順で何かを入れたら、次のコマンドを実行する前に **新しいターミナルを開いて** ください。そうしないと、入れたばかりのプログラムが見つからないことがあります。

## 1. git を入れる（または ZIP でダウンロードする）

git があるか確認します。

```sh
git --version
```

ない場合：

- macOS：`xcode-select --install` を実行し、表示される画面に従います。
- Windows（PowerShell）：`winget install --id Git.Git -e` を実行するか、[git-scm.com](https://git-scm.com/downloads/win) からダウンロードします。

git を入れたくなければ、この手順は飛ばして構いません。手順5で ZIP をダウンロードできます。

## 2. Bun を入れる

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

## 3. Claude Code（ネイティブ版）を入れてサインインする

`claude --version` がすでに動くなら入れ直しは不要です。ただし Windows の方は下の注意を読んでください。

macOS：

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Windows（PowerShell）：

```powershell
irm https://claude.ai/install.ps1 | iex
```

**新しいターミナルを開いて**、Claude Duet と同じ Claude アカウントでサインインします。

```sh
claude auth login
claude --version
```

**Windows での注意。** duet-send にはネイティブ版の `claude.exe` が必要です。npm 版（`npm install -g @anthropic-ai/claude-code`）は PATH に `claude.cmd` という起動用ファイルを置きますが、duet-send はこれを使わずに止まります。`cmd.exe` を通すと本文が壊れたり、コマンドとして実行されたりするおそれがあるためです。`claude` がどれを指しているか確認してください。

```powershell
where.exe claude
```

1行目が `.cmd` で終わっていたら、上の方法でネイティブ版を入れるか、`DUET_CLAUDE_BIN` に `claude.exe` のフルパスを設定してください。ネイティブ版のインストーラーは次の場所に置きます。

- PowerShell での書き方：`"$env:USERPROFILE\.local\bin\claude.exe"`
- コマンドプロンプトでの書き方：`%USERPROFILE%\.local\bin\claude.exe`

## 4. Google Workspace CLI（`gws`）を入れる

duet-send は `gws` でIDファイルの説明欄を読むので、コーディネーターが最後に書いたIDを常に取れます。`gws` は GitHub の googleworkspace オーガニゼーションが公開しているオープンソースのツールで、Google の公式サポート製品ではないと明記されています。まだ v1.0 前の段階です。

次のどれかの方法で入れます。

```sh
brew install googleworkspace-cli                # macOS（Homebrew）
winget install --id Google.WorkspaceCLI -e      # Windows
npm install -g @googleworkspace/cli             # どちらでも可。Node.js 18 以降が必要
```

続けてサインインします。

```sh
gws auth setup          # 初回のみ。gcloud CLI を使うか、Cloud Console で OAuth を手動設定
gws auth login -s drive
```

`drive` スコープはドライブ全体を読み書きできる権限なので注意してください。

設定はこれだけです。duet-send は **自分の** マイドライブ直下から `duet-coordinator-session-id.txt` を探して、その説明欄を読みます。説明欄が空のときは、代わりにファイルの本文をダウンロードします。サブフォルダにあるファイルや、他人から共有されたファイルは無視します。`DUET_DRIVE_FILE_ID`（手順6）を設定すると、検索を省いてそのファイルを直接読みます。

いちばん簡単な確認は、手順7の dry run です。duet-send とまったく同じ検索をします。手で検索してみたいときは、使っているシェルに合わせて次のどれかを実行します（3つとも duet-send と同じ条件で検索します）。

macOS（zsh / bash）：

```sh
gws drive files list --params "{\"q\":\"name = 'duet-coordinator-session-id.txt' and 'root' in parents and 'me' in owners and trashed = false\",\"fields\":\"files(id,description)\"}"
```

PowerShell 7.3 以降：

```powershell
gws drive files list --params '{"q":"name = ''duet-coordinator-session-id.txt'' and ''root'' in parents and ''me'' in owners and trashed = false","fields":"files(id,description)"}'
```

Windows PowerShell 5.1（標準の `powershell.exe`）：

```powershell
gws drive files list --params '{\"q\":\"name = ''duet-coordinator-session-id.txt'' and ''root'' in parents and ''me'' in owners and trashed = false\",\"fields\":\"files(id,description)\"}'
```

ファイルが1件、`id` と `session_` で始まる `description` 付きで表示されれば成功です（`description` がないときは、コーディネーターがまだ説明欄を書いていません。その間 duet-send は本文を読みます）。`description` はセッションIDの全体なので、出力をどこにも貼らないでください。それでもシェルが引用符を崩してしまうときは、dry run で確認してください。

## 5. duet-send を取ってくる

git がある場合：

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
```

git がない場合：https://github.com/Stella2211/duet-send を開き、**Code → Download ZIP** を選んで展開し、展開したフォルダでターミナルを開きます。

duet-send は実行時に依存パッケージを使いません。`bun install` は任意で、エディタ用の型定義が入るだけです。

スクリプトがビルドできるか確認します。

```sh
bun run check
```

## 6. 環境変数を設定する（必要なものだけ）

| 変数 | 必要になるとき |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | 名前での検索を省きたいとき |
| `DUET_DISCORD_WEBHOOK` | 送信に失敗したら Discord に知らせてほしいとき |
| `DUET_TAG` | 既定のタグを `[Claude Code]` 以外にしたいとき |
| `DUET_CLAUDE_BIN` / `DUET_GWS_BIN` | `claude` / `gws` が PATH にないとき、または定期実行するとき（手順8） |
| `DUET_SESSION_ID` | 最後の手段。IDそのもの（コーディネーターが変わると古くなります） |

macOS（zsh）：`~/.zshrc` に次のような行を足して、新しいターミナルを開きます。

```sh
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows：PowerShell で次を実行して、新しいターミナルを開きます。

```powershell
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 7. 動作を確認する

まずは送らずに試します。セッションIDと `claude` を探して、送る内容を表示するだけです。

```sh
bun run duet --dry-run "duet-send のテスト"
```

次のように表示されれば成功です。セッションIDはわざと短くしています。

```
to: session_01Ab…xyz
(read from: gws (Google Drive, file description))
claude: /Users/you/.local/bin/claude
message:
[Claude Code] duet-send のテスト
```

`read from:` はIDをどこから読んだかを示します。`file description` ならふだんどおりです。`file content` は説明欄が空だったという意味なので、コーディネーターに説明欄を書いてもらってください。

エラーが出たら、下のトラブルシューティングを見てください。

次に、実際にテストのメッセージを送ります（Claude Code はユーザーに確認してから）。

```sh
bun run duet "duet-send のテストです。届いたらチャットで返事をください。"
```

`duet: sent to session_…` と出れば、Claude Code がメッセージを届けています。返事は Duet のチャットで確認してください。セッションIDの全体や Claude Code 自身の出力が必要なときだけ、`--verbose` を付けてください。

## 8. 自分のスクリプトや定期実行から使う

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

**定期実行（cron、launchd、タスクスケジューラ、ボットのサービスなど）。** これらは `~/.zshrc` やユーザーの PATH を読みません。すべてフルパスで書き、変数はジョブの中で設定してください。

- `bun` のフルパス。`which bun`（macOS）か `(Get-Command bun).Source`（PowerShell）で確かめます。場所は Bun の入れ方で変わり、公式のインストーラーなら `~/.bun/bin/bun`、`%USERPROFILE%\.bun\bin\bun.exe` です
- `DUET_CLAUDE_BIN` に `claude`（または `claude.exe`）のフルパス
- `DUET_GWS_BIN` に `gws` のフルパス
- `DUET_DISCORD_WEBHOOK` など、使っているほかの変数

macOS の crontab の例（`you` やパスは自分のものに置き換えてください）：

```sh
0 9 * * * DUET_CLAUDE_BIN=/Users/you/.local/bin/claude /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --tag "[cron]" "おはようございます" >> /tmp/duet-send.log 2>&1
```

ジョブは `claude auth login` と `gws auth login` をしたのと同じユーザーで動かしてください。

## 9. 任意：Claude Code が作業を終えたらコーディネーターに知らせる（Stop hook）

Claude Code には、応答を終えるたびにコマンドを実行する仕組みがあります。これを [Stop hook](https://code.claude.com/docs/ja/hooks#stop) と呼びます。duet-send に `--hook` を付けると、それをコーディネーターへの短いメッセージに変えるので、手元の Claude Code が終わったことが Duet に伝わります。

コーディネーターには、次のようなメッセージが届きます。

```
[Claude Code: Stop] Claude Code finished responding in my-project.

Last message:
I've fixed the failing test and pushed the branch. ...
```

中身は、Claude Code が作業していたフォルダの名前（フルパスではありません）と、Claude の最後の返答の先頭500文字までです。

### 動くとき、動かないとき

- **Claude が応答を終えるたびに** 動きます。タスク全体が終わったときだけではありません。短い返事や、Claude があなたに質問して止まったときにも送られます。1ターンごとに1通届くと考えてください。
- あなたが Esc で中断したときは **動きません**。API のエラー（利用上限やサインインの問題など）でターンが終わったときは、代わりに `StopFailure` が動きます（下の「エラー用の2つ目の設定」を参照）。
- ターンの途中で Claude Code を閉じた・落ちたとき、パソコンがオフラインのとき、`claude` がサインインしていないときは送られません。送信に失敗し、`DUET_DISCORD_WEBHOOK` を設定していれば、いつもどおり Discord に知らせます。
- 送信はメッセージを届けるだけです。コーディネーターは次に動いたときに読みます。

つまり、Claude Code が普通に動いている限り「ターンが終わった」ことは確実に届きますが、どんな作業も必ず報告されるという保証ではありません。

### 書く場所

**ユーザー設定** に書けば、このパソコンのすべてのプロジェクトで動きます。

- macOS：`~/.claude/settings.json`
- Windows：`%USERPROFILE%\.claude\settings.json`

特定のプロジェクトだけで使いたいときは、同じ内容をそのプロジェクトの `.claude/settings.local.json` に書きます。プロジェクトで共有する `.claude/settings.json` には書かないでください。パスはあなたのパソコンにしかなく、そのファイルはコミットされて、プロジェクトを開く全員に読まれます。

ファイルがすでにあるときは、ファイルを置き換えずに `"hooks"` の部分を書き足してください。すでに `"hooks"` があるなら、その中に `"Stop"` を足します。

`hooks/hooks.json` は、Claude Code の [プラグイン](https://code.claude.com/docs/ja/plugins/overview) に hook を入れるときの形式です。自分のパソコンで使うだけなら `settings.json` のほうが簡単です。プラグインの `hooks/hooks.json` でも、同じ `{"hooks": {...}}` の部分をそのまま使えます（横に任意の `"description"` を置けます）。

### まず、2つのフルパスを確かめる

hook には、`bun` のフルパスと `send.ts` のフルパスが必要です。下の例をそのまま写さず、自分のパソコンで確かめてください。`bun` の場所は入れ方で変わります。公式のインストーラーなら `~/.bun/bin/` ですが、Homebrew、npm、バージョン管理ツールなどで入れた場合は別の場所になります。

macOS（2行目は duet-send のフォルダで実行します）：

```sh
which bun
echo "$PWD/send.ts"
```

Windows の PowerShell（2行目は duet-send のフォルダで実行します）：

```powershell
(Get-Command bun).Source
(Resolve-Path .\send.ts).Path
```

コマンドプロンプトなら、`where.exe bun` で `bun` のパスがわかります（`.exe` で終わる行を使います）。

表示されたフルパスをそのまま書いてください。hook はシェルを通さずに `bun` を起動するので、`~`、`$HOME`、`%USERPROFILE%` は展開されません。あとで Claude Code が見つけた `bun` を起動できない場合（バージョン管理ツールの起動用ファイルだった場合など）は、`bun -e "console.log(process.execPath)"` で表示されるパスを使ってください。こちらは `bun` 本体です。

### 書く内容

macOS（例のパスを、確かめた2つのパスに置き換えます）：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/you/.bun/bin/bun",
            "args": ["/Users/you/duet-send/send.ts", "--hook"],
            "async": true
          }
        ]
      }
    ]
  }
}
```

Windows（JSON の中では、パスの `\` を `\\` と書きます）：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "C:\\Users\\you\\.bun\\bin\\bun.exe",
            "args": ["C:\\Users\\you\\duet-send\\send.ts", "--hook"],
            "async": true
          }
        ]
      }
    ]
  }
}
```

設定の意味：

- `"command"` と `"args"` を分けて書くと、Claude Code はシェルを通さずに `bun` を直接起動します。パスに空白があっても引用符はいりません。Windows では本物の `.exe` が必要で、`bun.exe` はそれに当たります。
- `"async": true` にすると、Claude Code は送信を待たずに先へ進みます。duet-send は長くても60秒で自分から終わります。
- `--hook` のとき、duet-send は必ず終了コード0で終わり、問題は stderr にだけ書きます。Claude Code を止めたり、Claude に作業を続けさせたりすることはありません。
- Stop には `"matcher"` はいりません。

**`claude -p`（非対話モード）の終わりにも知らせたいとき：** `claude -p` が終了するときに動いている async の hook は Claude Code が打ち切るので、メッセージが送られないことがあります。`"async": true` を外して、代わりに `"timeout": 90` を書いてください。Claude Code は送信（ふつう数秒）を待ってから終了します。

**エラー用の2つ目の設定（任意）。** API のエラーでターンが終わったときにも知りたいなら、`"Stop"` の隣に `"StopFailure"` を足し、同じ `"hooks"` の中身を書きます。メッセージにはエラーの種類が入ります。

### hook の環境変数

hook は Claude Code の環境変数を引き継ぐので、手順6の変数は、設定したあとに起動した Claude Code なら効きます。デスクトップアプリやエディタから Claude Code を起動していて、hook が `claude` やほかの設定を見つけられないときは、同じ `settings.json` の `"env"` に書いてください。Claude Code は、hook を含め自分が起動するプログラムにこれを渡します。

```json
{
  "env": {
    "DUET_CLAUDE_BIN": "/Users/you/.local/bin/claude"
  }
}
```

### 確認する

1. `"command"` と `"args"` に書いた2つのパスをそのまま使い、Claude Code が渡す内容のサンプルで hook を手で動かします。書いたパスが正しいかを確かめるもので、何も送りません。

   macOS：

   ```sh
   echo '{"hook_event_name":"Stop","cwd":"/tmp/test","last_assistant_message":"Test reply."}' | /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --hook --dry-run
   ```

   Windows の PowerShell（サンプルは標準入力で渡すので、引用符を足す必要はありません）：

   ```powershell
   '{"hook_event_name":"Stop","cwd":"C:\\test","last_assistant_message":"Test reply."}' | & "C:\Users\you\.bun\bin\bun.exe" "C:\Users\you\duet-send\send.ts" --hook --dry-run
   ```

   `--hook` のときは終了コードが必ず0になるので、出力を見てください。`[Claude Code: Stop]` で始まる `message:` が出れば成功です。`duet:` で始まる行が出たら、そこに原因が書いてあります。

2. Claude Code で `/hooks` と入力し、ユーザー設定に `Stop` が出ているか確かめます。`settings.json` の変更はふつう自動で読み込まれます。出ていなければ、新しいセッションを始めてください。
3. Claude Code に短いことを頼み、Duet に `[Claude Code: Stop]` のメッセージが届くか確かめます。

### 通知を減らす、ループを防ぐ

- 1つのセッションだけ止めたいときは、`DUET_HOOK=1` を設定して Claude Code を起動します（例：`DUET_HOOK=1 claude`）。duet-send は hook を飛ばします。
- 一部のプロジェクトだけで使いたいときは、ユーザー設定ではなく、そのプロジェクトの `.claude/settings.local.json` に書きます。
- パソコンを見分けたいときは、`"args"` にタグを足します：`["/Users/you/duet-send/send.ts", "--hook", "--tag", "[Claude Code: Stop @MacBook]"]`。
- やめるときは、その設定を消します。hook を1つだけ止めるスイッチはなく、`"disableAllHooks": true` にするとすべての hook が止まります。

ループは duet-send 自身が防ぎます。`stop_hook_active` が true のとき（Stop hook のせいで Claude がすでに作業を続けているとき）は送らず、自分が起動する `claude` には `DUET_HOOK=1` を付けるので、自分の送信が hook をもう一度起こすことはありません。Duet のクラウドセッションはあなたの `~/.claude/settings.json` を読まないので、コーディネーター自身のターンで動くこともありません。

## トラブルシューティング

**`gws (Google Workspace CLI) was not found`**
`gws` を入れて（手順4）、新しいターミナルを開いてください。定期実行のときや、`gws` が PATH にないときは、`DUET_GWS_BIN` にフルパスを設定してください。

**`could not get the session id: gws failed (see above)`**
`gws` は入っているものの、IDを取れませんでした。理由はこの行のすぐ上に出ています。次の項目を見てください。

**`both the description and the content of Drive file ... are empty`**
コーディネーターがまだIDを書いていません。今のセッションIDをファイルの説明欄に書くよう頼んでください。

**`gws could not search Drive ...`、`gws could not read Drive file ...` または `gws could not download the file ...` に `invalid_grant`、`error[auth]`、`401` が含まれる**
`gws` のサインインが切れたか、取り消されています。`gws auth login -s drive` をもう一度実行してから、やり直してください。

**`gws found no duet-coordinator-session-id.txt in the root of your My Drive`**
ファイルがない、サブフォルダにある、または別のアカウントが持ち主になっています。コーディネーターにマイドライブ直下へ作ってもらうか、`DUET_DRIVE_FILE_ID` を設定してください。

**`warning: found 2 files named duet-coordinator-session-id.txt`**
これは警告だけで、処理は一番新しいファイルを使って続きます。消したいときは、古いものをドライブから削除するか、`DUET_DRIVE_FILE_ID` を設定してください。

**`... does not contain a session id`**
説明欄（本文を読んだ場合はファイルの中身）は、`session_`（または `cse_`）で始まるIDだけでなければいけません。コーディネーターに書き直してもらってください。メッセージに「the description of Drive file」とあれば、説明欄に別のものが入っています。ドライブでファイルの詳細を開くと確認できます。

**`cloud session session_… is archived and cannot accept new messages` または `Session not found`**
コーディネーターが入れ替わったのに、ファイルが古いIDのままです。Duet を開いて何か話しかけてください。新しいコーディネーターは起動時に自分のIDを確認し、ファイルの説明欄を書き換えます。1時間ごとの確認を設定している場合は、1時間ほどで自動的に直ります。`DUET_SESSION_ID` を使っている場合は、その値を更新してください。

**`Unable to get organization UUID`、または「Cloud sessions need a claude.ai sign-in」**
`claude auth login` で Claude アカウントにサインインしてください。APIキーだけでは使えません。

**`Cloud sessions are disabled by your organization's policy`**
Team や Enterprise のプランでは、組織のオーナーが Claude Code の管理設定でクラウドセッションを許可する必要があります。

**`... is a .cmd file and cannot be called safely`（Windows）**
手順3の Windows での注意を見てください。dry run でもこの確認をします。

**`claude was not found`**
インストール後に新しいターミナルを開くか、`DUET_CLAUDE_BIN` にフルパスを設定してください。定期実行では必ず設定してください。

**`duet: sent` と出たのに Duet に届かない**
`claude` が Duet と同じ Claude アカウントでサインインしているか（`claude auth status`）と、ファイルの説明欄のIDがコーディネーターの今のIDか（コーディネーターに聞いてください）を確認してください。dry run の `read from:` の行で、IDを説明欄と本文のどちらから読んだかがわかります。
