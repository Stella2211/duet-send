[English](setup-guide.md) | 日本語

# duet-send 導入ガイド

macOS、Linux、Windows に duet-send を入れる手順です。人が読みながら進めても、Claude Code がユーザーの代わりに進めても良いように書いています。

> **Claude Code へ：** 手順を順番に進め、各手順の最後にある確認を実行してください。ソフトウェアはここに書いた公式のコマンドだけで入れてください。シェルの設定ファイルや環境変数への書き込み、実際のメッセージの送信（手順6）、Claude Code の設定ファイルの編集（任意の手順8）は、ユーザーの了承を得てから行ってください。duet-send は出力の中のセッションIDを短くして表示します。`--verbose` を付けて実行せず、セッションIDの全体を表示・コピー・保存しないでください。
>
> 次の操作は人の入力を待つので、Claude Code からは進められません。最初にユーザーの担当だと伝え、そこまで来たら止まって引き渡してください。
>
> - ターミナルでパスワードや確認を求めるもの：`sudo`、`yay` などの AUR ヘルパー（ビルド内容の確認を求めます）
> - ブラウザでのサインイン：`claude auth login`（手順3）
> - ルーティング表のファイルをリンクで共有すること（手順0）：ユーザーが Google ドライブで行います
>
> 入力のいらない短いコマンドは、ユーザーがこのセッションのプロンプトで先頭に `!` を付けて打てば実行できます。入力を待つもの（パスワード、確認、ブラウザでのサインイン）は、別のターミナルで実行してもらうのが確実です。終わったと言われたら、その手順の確認を実行してください。

## 全体の仕組み

```
自分のスクリプト / ボット / Claude Code
        │  bun run duet "メッセージ"
        ▼
   duet-send ── 読む ──▶ ルーティング表のファイル名（Google ドライブ、リンク共有）
        │
        │  claude -p "[タグ] メッセージ" --cloud <セッションID>
        ▼
 Claude Duet のコーディネーター（クラウドの Claude Code セッション）
```

コーディネーターは、自分のセッションIDをルーティング表（1行の JSON）にして、Google ドライブの1つのファイルの **ファイル名** にしています。IDが変わるたびにファイル名を付け替えます（[DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md) を参照）。ファイル名を使うのは、Claude の Google ドライブ コネクタがファイル名は変えられても、本文は変えられないためです。ファイルは「リンクを知っている全員」・閲覧者で共有します。duet-send は `https://drive.google.com/uc?export=download&id=<FILE_ID>` にサインインなしのふつうの HTTPS でアクセスし、レスポンスからファイル名だけを読みます（本文は読みません。最長15秒）。ルーティング表は次のような形です。

```json
{"version":1,"updated_at":"2026-11-23T03:30:00Z","default":"main","routes":{"main":"session_..."}}
```

`default` はルートを選ばなかったときに使うルートです。`--to <ルート名>` で別のルートを選べます（手順7を参照）。`main` はコーディネーター自身です。`updated_at` は省略でき、`--dry-run` で表示するだけです。

## 0. 始める前に

- **先にルーティング表のファイルが必要です。** Duet のコーディネーターにこのリポジトリのリンクを渡して、duet-send の設定を頼んでください。コーディネーターが Google ドライブに `duet-send` フォルダを作ってルーティング表のファイル（とフォルダの説明の README）を置き、その **Drive ファイルID**（ファイルのリンクの `/d/` の後ろの部分、または `id=` の値）を教えてくれます。そのあと、ドライブでルーティング表のファイル（フォルダではなく）の **共有 → 一般的なアクセス** を開き、**リンクを知っている全員**、権限を **閲覧者** にしてください。編集者やコメント可には絶対にしないでください。編集できる人はファイル名を変えて、あなたのメッセージの届け先を変えられます。IDは自分だけで持ち、コミットしないでください。
- Claude Code とクラウドセッションが使えるプランが必要です（Pro、Max、Team、または対応する席の Enterprise）。`--cloud` での送信には Claude アカウントでのサインインが必要で、APIキーだけの場合や、Amazon Bedrock・Google Vertex AI などの外部プロバイダー経由では使えません。
- 以下の手順で何かを入れたら、次のコマンドを実行する前に **新しいターミナルを開いて** ください。そうしないと、入れたばかりのプログラムが見つからないことがあります。

すでに入っているものを確かめるには、次を1行ずつ実行します（入っていないものは「command not found」になりますが、それで構いません）。

```sh
git --version
bun --version
claude --version
claude auth status
```

`claude auth status` は Claude Code にサインイン済みかを表示します。入っているものの手順は飛ばして構いませんが、各手順の確認は実行してください。

## 1. git を入れる（または ZIP でダウンロードする）

git があるか確認します。

```sh
git --version
```

ない場合：

- macOS：`xcode-select --install` を実行し、表示される画面に従います。
- Linux：ディストリビューションのパッケージマネージャーで入れます。たとえば `sudo pacman -S git`（Arch）、`sudo apt install git`（Debian、Ubuntu）。
- Windows（PowerShell）：`winget install --id Git.Git -e` を実行するか、[git-scm.com](https://git-scm.com/downloads/win) からダウンロードします。

git を入れたくなければ、この手順は飛ばして構いません。手順4で ZIP をダウンロードできます。

## 2. Bun を入れる

macOS と Linux：

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

macOS と Linux：

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

## 4. duet-send を取ってくる

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

## 5. 環境変数を設定する（必要なものだけ）

| 変数 | 必要になるとき |
| --- | --- |
| `DUET_ROUTES_FILE_ID` | 必ず設定します（`DUET_SESSION_ID` だけで使う場合を除く）。ルーティング表のファイルの Drive ファイルID |
| `DUET_DISCORD_WEBHOOK` | 送信そのものに失敗したとき（IDが古いときなど）や、Claude Code を起動できないとき（`claude` が見つからない、起動に失敗する）に Discord に知らせてほしいとき。通知されず stderr に出るだけなのは、ルーティング表のファイルを読めなかったとき、本文が長すぎるとき、hook の50秒タイムアウトです。hook として動くときは stderr を見る人がいないので、これらは気づかれずに失敗します |
| `DUET_TAG` | 既定のタグを `[Claude Code]` 以外にしたいとき。`--hook` では使われません（hook のタグは `[Claude Code: Stop]` で、変えるときは `--tag`） |
| `DUET_CLAUDE_BIN` | `claude` が PATH にないとき、または定期実行するとき（手順7） |
| `DUET_SESSION_ID` | IDそのもの。`DUET_ROUTES_FILE_ID` がないときに使い、ルーティング表のファイルを読めないときも代わりに使います（警告が出ます）。コーディネーターが変わると古くなります |

macOS（zsh）：`~/.zshrc` に次のような行を足して、新しいターミナルを開きます。Linux では、使っているシェルのファイル（たいていは `~/.bashrc`）に足します。

```sh
export DUET_ROUTES_FILE_ID="<FILE_ID>"
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows：PowerShell で次を実行して、新しいターミナルを開きます。

```powershell
[Environment]::SetEnvironmentVariable("DUET_ROUTES_FILE_ID", "<FILE_ID>", "User")
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 6. 動作を確認する

下の dry run で確かめられるのは、duet-send がIDを **読めるか** までです。そのIDがまだ有効かは分かりません。コーディネーターが入れ替わってルーティング表のファイルが古いIDのままだと、dry run は成功し、実際の送信が「archived」や「Session not found」で失敗します。そのときは Duet を開いてコーディネーターに何か話しかけてください。コーディネーターは起動時に自分のIDを確かめてファイル名を付け替えるので、そのあとでもう一度送ります。

まずは送らずに試します。セッションIDと `claude` を探して、送る内容を表示するだけです。

```sh
bun run duet --dry-run "duet-send のテスト"
```

次のように表示されれば成功です。セッションIDはわざと短くしています。

```
to: main (session_01Ab…xyz)
(read from: the routes file (Google Drive))
updated: 2026-11-23T03:30:00Z
claude: /Users/you/.local/bin/claude
message:
[Claude Code] duet-send のテスト
```

`to:` はルートとそのIDを示します。`read from: the routes file (Google Drive)` ならふだんどおりです。`DUET_SESSION_ID` と出たときは、その変数からIDを読んだという意味です。ルーティング表のファイルを設定していないか、読めなかったかのどちらかです（どちらかは stderr の警告でわかります）。`updated:` は、ルーティング表に `updated_at` があるときだけ表示されます。

エラーが出たら、下のトラブルシューティングを見てください。

次に、実際にテストのメッセージを送ります（Claude Code はユーザーに確認してから）。

```sh
bun run duet "duet-send のテストです。届いたらチャットで返事をください。"
```

`duet: sent to session_…` と出れば、Claude Code がメッセージを届けています。返事は Duet のチャットで確認してください。セッションIDの全体や Claude Code 自身の出力が必要なときだけ、`--verbose` を付けてください。

「archived」や「Session not found」で失敗したときは、IDが古くなっています（この手順の最初を参照）。Duet でコーディネーターに話しかけ、ファイル名が付け替わるのを待ってから、もう一度送ってください。

Stop hook（手順8）をすでに設定していて、このテストを Claude Code から実行すると、その Claude Code のターンが終わったときに `[Claude Code: Stop]` のメッセージがもう1通届きます。テストのコマンドの前に `DUET_HOOK=1` を付けても止まりません。hook を起動するのはあなたのコマンドではなく Claude Code だからです。避けたいときは、その Claude Code を `DUET_HOOK=1 claude` で起動してください（手順8を参照）。

## 7. 自分のスクリプトや定期実行から使う

スクリプトをフルパスで呼び、誰が送ったかわかるタグを付けます。

```sh
bun /path/to/duet-send/send.ts --tag "[夜間ビルド]" "main のビルドが失敗しました"
```

Node や Bun のプログラムから呼ぶときは、シェルのコマンド文字列を組み立てずに、本文を引数として渡してください。

```ts
import { execFile } from "node:child_process";
execFile("bun", ["/path/to/duet-send/send.ts", "--tag", "[Discord bot]", message]);
```

ルーティング表に複数のルートがあるときは、`--to <ルート名>` で既定のルートではなくそのルートに送れます。例：`bun /path/to/duet-send/send.ts --to work --tag "[夜間ビルド]" "ビルドが失敗しました"`。`--to` を付けたときは `DUET_SESSION_ID` に切り替えず、ルートを読めなければ何も送りません。

本文が `-` で始まるかもしれないときは、前に `--` を置きます：`bun run duet -- "-5件のテストが失敗"`。`--` がないとき、`-` で始まっていて duet-send が知らないオプション（`--dry-rnu` のような打ち間違いなど）は、本文として送られず、終了コード2で拒否されます。`--tag=<タグ>`、`--to=<ルート名>` の形も使えます。（どちらの場合も、duet-send は本文を `--` の後ろに置いて `claude` に渡すので、`claude` 自身のオプションとして読まれることはありません。）

**定期実行（cron、launchd、タスクスケジューラ、ボットのサービスなど）。** これらは `~/.zshrc` やユーザーの PATH を読みません。すべてフルパスで書き、変数はジョブの中で設定してください。

- `bun` のフルパス。`which bun`（macOS、Linux）か `(Get-Command bun).Source`（PowerShell）で確かめます。場所は Bun の入れ方で変わり、公式のインストーラーなら `~/.bun/bin/bun`、`%USERPROFILE%\.bun\bin\bun.exe` です
- `DUET_CLAUDE_BIN` に `claude`（または `claude.exe`）のフルパス
- `DUET_ROUTES_FILE_ID` にルーティング表のファイルの Drive ファイルID
- `DUET_DISCORD_WEBHOOK` など、使っているほかの変数

macOS の crontab の例（`you` やパスは自分のものに置き換えてください。Linux ではホームフォルダが `/home/you` の下になります）：

```sh
0 9 * * * DUET_ROUTES_FILE_ID=<FILE_ID> DUET_CLAUDE_BIN=/Users/you/.local/bin/claude /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --tag "[cron]" "おはようございます" >> /tmp/duet-send.log 2>&1
```

ジョブは `claude auth login` をしたのと同じユーザーで動かしてください。

## 8. 任意：Claude Code が作業を終えたらコーディネーターに知らせる（Stop hook）

Claude Code には、応答を終えるたびにコマンドを実行する仕組みがあります。これを [Stop hook](https://code.claude.com/docs/ja/hooks#stop) と呼びます。duet-send に `--hook` を付けると、それをコーディネーターへの短いメッセージに変えるので、手元の Claude Code が終わったことが Duet に伝わります。

コーディネーターには、次のようなメッセージが届きます。

```
[Claude Code: Stop] Claude Code finished responding in my-project.

Last message:
I've fixed the failing test and pushed the branch. ...
```

中身は、Claude Code が作業していたフォルダの名前（フルパスではありません）と、Claude の最後の返答です。メッセージ全体（タグを除く）は、ほかの duet-send のメッセージと同じく8,000文字までです。返答には最初の行の残りの分をすべて使い、それより長いときはそこで `…` を付けて切ります。

### 動くとき、動かないとき

- **Claude が応答を終えるたびに** 動きます。タスク全体が終わったときだけではありません。短い返事や、Claude があなたに質問して止まったときにも送られます。1ターンごとに1通届くと考えてください。
- あなたが Esc で中断したときは **動きません**。API のエラー（利用上限やサインインの問題など）でターンが終わったときは、代わりに `StopFailure` が動きます（下の「エラー用の2つ目の設定」を参照）。
- ターンの途中で Claude Code を閉じた・落ちたとき、パソコンがオフラインのとき、`claude` がサインインしていないときは送られません。`claude -p ... --cloud` 自体が失敗し、`DUET_DISCORD_WEBHOOK` を設定していれば、いつもどおり Discord に知らせます（通知にもネットワークが必要です）。Claude Code をそもそも起動できないとき（`claude` が見つからない、起動に失敗する）も同じです。それより前の問題（ルーティング表のファイルを読めなかったときなど）と50秒のタイムアウトは stderr に出るだけで、hook では誰の目にも触れません。
- 送信はメッセージを届けるだけです。コーディネーターは次に動いたときに読みます。

つまり、Claude Code が普通に動いている限り「ターンが終わった」ことは確実に届きますが、どんな作業も必ず報告されるという保証ではありません。

### 書く場所

**ユーザー設定** に書けば、このパソコンのすべてのプロジェクトで動きます。

- macOS と Linux：`~/.claude/settings.json`
- Windows：`%USERPROFILE%\.claude\settings.json`

特定のプロジェクトだけで使いたいときは、同じ内容をそのプロジェクトの `.claude/settings.local.json` に書きます。プロジェクトで共有する `.claude/settings.json` には書かないでください。パスはあなたのパソコンにしかなく、そのファイルはコミットされて、プロジェクトを開く全員に読まれます。

ファイルがすでにあるときは、ファイルを置き換えずに `"hooks"` の部分を書き足してください。すでに `"hooks"` があるなら、その中に `"Stop"` を足します。すでに `"Stop"` のリストがあるなら、そこにある設定は消さずに、duet-send の設定をリストに追加します。手で書き足すと壊しやすいので、macOS と Linux では `jq` に任せることもできます（下の「jq で追加する」を参照）。

`hooks/hooks.json` は、Claude Code の [プラグイン](https://code.claude.com/docs/ja/plugins/overview) に hook を入れるときの形式です。自分のパソコンで使うだけなら `settings.json` のほうが簡単です。プラグインの `hooks/hooks.json` でも、同じ `{"hooks": {...}}` の部分をそのまま使えます（横に任意の `"description"` を置けます）。

### まず、2つのフルパスを確かめる

hook には、`bun` のフルパスと `send.ts` のフルパスが必要です。下の例をそのまま写さず、自分のパソコンで確かめてください。`bun` の場所は入れ方で変わります。公式のインストーラーなら `~/.bun/bin/` ですが、Homebrew、npm、バージョン管理ツールなどで入れた場合は別の場所になります。

macOS と Linux（2行目は duet-send のフォルダで実行します）：

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

macOS と Linux（例のパスを、確かめた2つのパスに置き換えます）：

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

### jq で追加する（macOS、Linux）

`~/.claude/settings.json` がすでにあるとき、次のコマンドはバックアップを取ってから `hooks.Stop` に設定を1つ追加します。ほかの設定（ほかの Stop hook も含む）はそのまま残ります。最初の2行に、確かめた2つのパスを入れてください。

```sh
BUN=/Users/you/.bun/bin/bun
SEND=/Users/you/duet-send/send.ts
cp ~/.claude/settings.json ~/.claude/settings.json.bak && \
jq --arg bun "$BUN" --arg send "$SEND" \
  '.hooks.Stop += [{"hooks": [{"type": "command", "command": $bun, "args": [$send, "--hook"], "async": true}]}]' \
  ~/.claude/settings.json.bak > ~/.claude/settings.json
```

実行は1回だけにしてください。実行するたびに設定が1つずつ増えます。うまくいかなかったときは、`cp ~/.claude/settings.json.bak ~/.claude/settings.json` で元に戻せます。ファイルがまだないときは、上の設定全体を書いて新しく作ってください。

設定の意味：

- `"command"` と `"args"` を分けて書くと、Claude Code はシェルを通さずに `bun` を直接起動します。パスに空白があっても引用符はいりません。Windows では本物の `.exe` が必要で、`bun.exe` はそれに当たります。
- `"async": true` にすると、Claude Code は送信を待たずに先へ進みます。duet-send は長くても50秒で自分から終わります。
- `--hook` のとき、duet-send は必ず終了コード0で終わり、問題は stderr にだけ書きます。Claude Code を止めたり、Claude に作業を続けさせたりすることはありません。
- Stop には `"matcher"` はいりません。

**`claude -p`（非対話モード）の終わりにも知らせたいとき：** `claude -p` が終了するときに動いている async の hook は Claude Code が打ち切るので、メッセージが送られないことがあります。`"async": true` を外して、代わりに `"timeout": 90` を書いてください。Claude Code は送信（ふつう数秒）を待ってから終了します。

**エラー用の2つ目の設定（任意）。** API のエラーでターンが終わったときにも知りたいなら、`"Stop"` の隣に `"StopFailure"` を足し、同じ `"hooks"` の中身を書きます。メッセージには（エラーの種類がわかるときは）その種類が入ります。

### hook の環境変数

hook は Claude Code の環境変数を引き継ぐので、手順5の変数は、設定したあとに起動した Claude Code なら効きます。デスクトップアプリやエディタから Claude Code を起動していて、hook が `claude` やほかの設定を見つけられないときは、同じ `settings.json` の `"env"` に書いてください。Claude Code は、hook を含め自分が起動するプログラムにこれを渡します。

```json
{
  "env": {
    "DUET_CLAUDE_BIN": "/Users/you/.local/bin/claude"
  }
}
```

### 確認する

1. `"command"` と `"args"` に書いた2つのパスをそのまま使い、Claude Code が渡す内容のサンプルで hook を手で動かします。書いたパスが正しいかを確かめるもので、何も送りません。

   macOS と Linux：

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

## 9. 任意：ほかのチャットも自分のルートを更新する

Duet のチャットを複数使っているときは、チャットごとにコーディネーターのセッションがあり、セッションIDもそれぞれ違います。どれかが入れ替わっても `--to <ルート>` が使えるように、各コーディネーターが同じルーティング表の中で **自分のルート** を最新に保つ必要があります。各チャットのセッションIDは、それぞれ別のタイミングで変わります。コーディネーターは自分の今のIDを `get_session` でしか知れないので、各チャットが自分のルートを最新に保ちます。

ほかのチャットごとに、1回ずつ次の作業をします。

1. メインのコーディネーターに、ルーティング表のファイルの Drive ファイルIDを聞きます。そのチャットのルート名（例：`work`）も決めます。
2. 2つのプレースホルダーを埋めて、次の文をそのチャットに貼ります。

```
duet-send のルーティング表に、このチャットのルートを追加してください。
- ルーティング表は Google ドライブのファイル（ファイルID: <ROUTES_FILE_ID>）のファイル名に、1行の JSON で入っています。このチャットのルート名は "<ROUTE_NAME>" です。
- get_session（session_id なし）で自分のセッションIDを読んでください。
- 書き換える直前に、ファイルのメタデータからタイトルと etag を読み直し、routes の "<ROUTE_NAME>" と updated_at だけを変えてください。ほかのルートは変えないでください。更新には読んだ etag を渡し、失敗したら読み直してやり直してください。新しいファイルは作らないでください。
- 書いたあとは、ファイル名を読み返して、正しい JSON で自分のIDが入っているか確かめてください。
- ファイルIDとルート名をメモリに残し、新しいセッションを始めるたびに上の確認をしてください。
```

3. 使うとき：`bun run duet --to <ルート> "メッセージ"`

複数のセッションが同じファイル名に書き込むので、互いに上書きしてはいけません。そのため、上の依頼では、書き込む直前にタイトルと etag を読み直し、自分のキーだけを変え、etag を渡して更新するよう伝えています。間にファイルが変わっていたら Drive が書き込みを断るので、コーディネーターは読み直してやり直します。書いたあとは、ファイル名を読み返して、正しい JSON になっているか確かめます。

### 書き換えのたびの承認をなくす

そのままだと、コーディネーターは書き換えのたびにあなたに確認するので、書き換えはあなたが答えるまで止まります。Claude Duet には、これに使う「ルール」があります。チャットで、たとえば次のように自分の言葉で伝えます。

```
duet-sendのルーティング表（Driveのファイル）のタイトルを書き換えてセッションIDを更新するのは、毎回聞かなくていい
```

Duet がルールのカードを出すので、承認してください。ルールは、そのチャットでのあなた自身のメッセージから作る必要があります。コーディネーターは、人づてに伝えられた指示や、ほかの人のメッセージ、メモリからは作れません。あるチャットのコーディネーターが書き換えの前にまだ確認してくるときは、そのチャットで同じ依頼を自分で送り、そこでルールを承認してください。

## 0.2（gws）からの移行

バージョン 0.3 では、`gws`、ドライブのファイルの説明欄、`duet-coordinator-session-id.txt` を使いません。移行するには：

1. Duet のコーディネーターにルーティング表のファイルを作り直してもらいます（[DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md) に沿って進みます）。ファイルをリンクで共有し、閲覧者にします（手順0）。
2. `DUET_ROUTES_FILE_ID` に、新しいファイルの Drive ファイルIDを設定します（手順5）。
3. `DUET_DRIVE_FILE_ID` と `DUET_GWS_BIN` を設定していたら削除します。もう無視されます。
4. `gws` 本体と、古い `duet-coordinator-session-id.txt` はもう要りません。ほかで使っていなければ削除して構いません。

## トラブルシューティング

**`no destination: set DUET_ROUTES_FILE_ID ...`**
duet-send を動かすシェルやジョブで `DUET_ROUTES_FILE_ID`（手順5）を設定するか、`DUET_SESSION_ID` を設定してください。

**`DUET_ROUTES_FILE_ID does not look like a Google Drive file id`**
値はIDだけ（英数字、`-`、`_`）にしてください。リンク全体ではありません。ファイルのリンクの `/d/` の後ろの部分、または `id=` の値です。

**`could not read the routes file (HTTP ...). Check the file id, and that the file is shared as "Anyone with the link" with the Viewer role` または `Google returned a web page instead of the routes file. ...`**
Google がファイルを渡しませんでした。ファイルがリンク共有になっていない（このとき Google はサインインのページを返します）か、IDが違います。ドライブで **共有 → 一般的なアクセス** を開き、**リンクを知っている全員**・権限 **閲覧者** にして、IDをコーディネーターに確かめてください。

**`... is not valid JSON`**
ファイル名が1行のルーティング表の JSON になっていません。誰かが手で名前を変えたのかもしれません。コーディネーターにファイル名を付け直してもらってください。ドライブでは長い名前が変に表示されることがありますが、それで正常です。

**`unknown route ...`、`"default" ... is not in "routes"` または `unsupported routes version ...`**
ルーティング表に、表にない名前や、この duet-send が知らないバージョンが入っています。コーディネーターに表を直してもらうか、duet-send を更新（`git pull`）してください。

**`route "..." does not contain a session id`**
そのルートの値がセッションID（`session_` または `cse_` で始まるもの）ではありません。コーディネーターに書き直してもらってください。

**`could not read the routes file (Google Drive): ...`**
Google ドライブから答えが返る前に通信が失敗しました。多くは、ネットワークが切れているか、プロキシやファイアウォールが `drive.google.com` や `drive.usercontent.google.com` を止めています。ネットワークを確かめて、やり直してください。`DUET_SESSION_ID` を設定していれば、警告を出してそれを使います。

**`timed out after 15 seconds reading the routes file`**
Google ドライブが時間内に答えませんでした。ネットワークを確かめて、やり直してください。`DUET_SESSION_ID` を設定していれば、警告を出してそれを使います。

**`cloud session session_… is archived and cannot accept new messages` または `Session not found`**
コーディネーターが入れ替わったのに、ルーティング表のファイルが古いIDのままです。Duet を開いて何か話しかけてください。新しいコーディネーターは起動時に自分のIDを確認し、ファイル名を付け替えます。`DUET_SESSION_ID` を使っている場合は、その値を更新してください。

**`Unable to get organization UUID`、または「Cloud sessions need a claude.ai sign-in」**
`claude auth login` で Claude アカウントにサインインしてください。APIキーだけでは使えません。

**`Cloud sessions are disabled by your organization's policy`**
Team や Enterprise のプランでは、組織のオーナーが Claude Code の管理設定でクラウドセッションを許可する必要があります。

**`... is a .cmd file and cannot be called safely`（Windows）**
手順3の Windows での注意を見てください。dry run でもこの確認をします。

**`claude was not found`**
インストール後に新しいターミナルを開くか、`DUET_CLAUDE_BIN` にフルパスを設定してください。定期実行では必ず設定してください。

**`duet: sent` と出たのに Duet に届かない**
`claude` が Duet と同じ Claude アカウントでサインインしているか（`claude auth status`）と、ルーティング表のファイルのIDがコーディネーターの今のIDか（コーディネーターに聞いてください）を確認してください。dry run の `read from:` の行で、IDをルーティング表のファイルと `DUET_SESSION_ID` のどちらから読んだかがわかります。
