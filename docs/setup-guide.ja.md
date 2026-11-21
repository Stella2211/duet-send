[English](setup-guide.md) | 日本語

# duet-send 導入ガイド

macOS、Linux、Windows に duet-send を入れる手順です。人が読みながら進めても、Claude Code がユーザーの代わりに進めても良いように書いています。

> **Claude Code へ：** 手順を順番に進め、各手順の最後にある確認を実行してください。ソフトウェアはここに書いた公式のコマンドだけで入れてください。シェルの設定ファイルや環境変数への書き込み、実際のメッセージの送信（手順7）、Claude Code の設定ファイルの編集（任意の手順9）は、ユーザーの了承を得てから行ってください。duet-send は出力の中のセッションIDを短くして表示します。`--verbose` を付けて実行せず、セッションIDの全体を表示・コピー・保存しないでください。
>
> 次の操作は人の入力を待つので、Claude Code からは進められません。最初にユーザーの担当だと伝え、そこまで来たら止まって引き渡してください。
>
> - ターミナルでパスワードや確認を求めるもの：`sudo`、`yay` などの AUR ヘルパー（ビルド内容の確認を求めます）
> - ブラウザでのサインイン：`claude auth login`（手順3）、`gcloud auth login` と `gws auth setup` / `gws auth login`（手順4）
> - 手順4の Google Cloud Console での作業：同意画面、テストユーザー、OAuth クライアント
>
> 入力のいらない短いコマンドは、ユーザーがこのセッションのプロンプトで先頭に `!` を付けて打てば実行できます。入力を待つもの（パスワード、確認、ブラウザでのサインイン）は、別のターミナルで実行してもらうのが確実です。終わったと言われたら、その手順の確認を実行してください。

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

すでに入っているものを確かめるには、次を1行ずつ実行します（入っていないものは「command not found」になりますが、それで構いません）。

```sh
git --version
bun --version
claude --version
claude auth status
gws --version
gcloud --version
```

`claude auth status` は Claude Code にサインイン済みかを表示します。`gcloud` は手順4の自動設定を使うときだけ必要です。入っているものの手順は飛ばして構いませんが、各手順の確認は実行してください。

## 1. git を入れる（または ZIP でダウンロードする）

git があるか確認します。

```sh
git --version
```

ない場合：

- macOS：`xcode-select --install` を実行し、表示される画面に従います。
- Linux：ディストリビューションのパッケージマネージャーで入れます。たとえば `sudo pacman -S git`（Arch）、`sudo apt install git`（Debian、Ubuntu）。
- Windows（PowerShell）：`winget install --id Git.Git -e` を実行するか、[git-scm.com](https://git-scm.com/downloads/win) からダウンロードします。

git を入れたくなければ、この手順は飛ばして構いません。手順5で ZIP をダウンロードできます。

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

## 4. Google Workspace CLI（`gws`）を入れる

duet-send は `gws` でIDファイルの説明欄を読むので、コーディネーターが最後に書いたIDを常に取れます。`gws` は GitHub の googleworkspace オーガニゼーションが公開しているオープンソースのツールで、Google の公式サポート製品ではないと明記されています。まだ v1.0 前の段階です。

**すでに `gws` を入れていて Drive を読めるなら、この手順は飛ばしてください。サインインもやり直さないでください。** `gws auth status` で確かめます。`auth_method` が `oauth2` で、スコープに `https://www.googleapis.com/auth/drive` か `https://www.googleapis.com/auth/drive.readonly` があれば大丈夫です。そのうえで、この手順の最後にある検索コマンドか、手順7の dry run が通ればOKです。`gws auth login` をやり直すと、今のサインインがそのとき選んだスコープで置き換わり、`gws` を使うほかのツールが Drive 以外や書き込みを使えなくなることがあります。

次のどれかの方法で入れます。

```sh
brew install googleworkspace-cli                # macOS（Linux でも可）。Homebrew
winget install --id Google.WorkspaceCLI -e      # Windows
npm install -g @googleworkspace/cli             # どのOSでも可（Linux を含む）。Node.js 18 以降が必要
```

Homebrew のない Linux では npm の行を使います（環境によっては `npm install -g` に `sudo` が必要です）。[gws のリリースページ](https://github.com/googleworkspace/cli/releases) からビルド済みのバイナリを落として、`gws` を PATH の通った場所に置く方法もあります。

### Google にサインインする

`gws` には専用の OAuth クライアントが必要で、それは Google Cloud のプロジェクトの中に作ります。このガイドでいちばん手間のかかる所ですが、一度だけです。方法は2つあります。

- **A. gcloud CLI で自動設定する。** `gws auth setup` がプロジェクトを作るか選び、API を有効にし、サインインするかを聞いてきます（`n` と答えます。下のA3を参照）。`gcloud` が入っていて、サインイン済みである必要があります。ただし OAuth クライアントそのものは、Cloud Console で手で作る必要があります。必要になったところで setup が案内します（下の B2 と B3）。
- **B. Cloud Console で手で設定する。** `gcloud` はいりません。

プロジェクトは、ほかの用途に使っているものではなく、**gws 専用に新しく作る** のをおすすめします。以下の手順で、そのプロジェクトの OAuth 同意画面や有効な API を変えるためです。

#### A. gcloud を使う

1. **gcloud を入れる。**
   - macOS、Windows、Debian / Ubuntu（Google の apt リポジトリ）、Red Hat / Fedora、その他の Linux（tar.gz）：Google の [Google Cloud CLI をインストールする](https://cloud.google.com/sdk/docs/install) ページの手順に従います。
   - Arch Linux：AUR の `google-cloud-cli` パッケージです。たとえば `yay -S google-cloud-cli`。AUR はコミュニティが管理していて、Google のものではありません。

   新しいターミナルを開いて、`gcloud --version` で確かめます。
2. **gcloud にサインインする**（ブラウザが開きます）。

   ```sh
   gcloud auth login
   ```

3. **プロジェクトを決める。** 新しく作るときは、[Cloud Console](https://console.cloud.google.com/projectcreate) か `gcloud projects create <PROJECT_ID>` で作ります。プロジェクトIDは世界中で一意なので、`duet-send-gws-` のあとにランダムな英字を足すなど、他人と重ならないものにします。そのIDを指定して設定を始めます。

   ```sh
   gws auth setup --project <PROJECT_ID>
   ```

   最後に setup が「Run `gws auth login` now? [Y/n]」と聞いてきます。`n` と答えて、下の「最後にサインインする」のコマンドでサインインしてください。`Y` と答えると、ずっと広いスコープ（Drive 全体、Gmail、カレンダーなど）があらかじめ選ばれたスコープ選択画面が開きます。

   `--project` を付けないと gcloud の現在のプロジェクトを使い、それもないときは「No GCP project configured」で止まります（`gcloud config set project <PROJECT_ID>` で設定できます）。
4. **「Manual OAuth client setup required」（または「OAuth client creation requires manual setup」）と出たら**、そのプロジェクトで下の B2 と B3 を行います。同意画面は setup がすでに作っていることがあるので、種類が外部になっているか、自分がテストユーザーに入っているかを確かめてください。続けてクライアントIDとクライアントシークレットを聞かれるので、貼り付けます。聞かれずに止まったときは、B3 のとおり JSON を保存してから `gws auth login` に進みます。

#### B. Cloud Console で手で設定する

リンクの `<PROJECT_ID>` は自分のプロジェクトIDに置き換えます（プロジェクトがなければ、先に [Cloud Console](https://console.cloud.google.com/projectcreate) で作ります）。

1. **Google Drive API を有効にする**：`https://console.cloud.google.com/apis/library/drive.googleapis.com?project=<PROJECT_ID>` を開いて **有効にする** を押します（**管理** と出ていれば有効になっています）。
2. **OAuth 同意画面を設定する**：`https://console.cloud.google.com/apis/credentials/consent?project=<PROJECT_ID>` を開きます。
   - ユーザーの種類（対象）：**外部**。テストモードでも動きますが、その場合 Google はサインインを7日で切れるようにするので、サインインし直すまで `gws` が `invalid_grant` で失敗します。避けたいときは **アプリを公開**（Publish app）を押して「本番環境」にします。未確認のアプリのままですが、自分で使うだけなら問題ありません。
   - アプリ名は何でも構いません（たとえば `gws CLI`）。サポートメールは自分のアドレスにします。
   - **テストユーザー** で **ユーザーを追加** を押し、自分の Google アカウントを足します。これを忘れると、サインインが「アクセスをブロック」で失敗します。
3. **OAuth クライアントを作る**：`https://console.cloud.google.com/apis/credentials?project=<PROJECT_ID>` を開き、**認証情報を作成 → OAuth クライアント ID** を選びます。
   - アプリケーションの種類：**デスクトップ アプリ**（ほかの種類だと、あとで `redirect_uri_mismatch` になります）。リダイレクトURIを入れる必要はありません。
   - 作成後に出る画面で JSON をダウンロードし、`~/.config/gws/client_secret.json`（Windows では `%USERPROFILE%\.config\gws\client_secret.json`）として保存します。フォルダがなければ作ります。このファイルは認証情報なので、コミットしたりどこかに貼ったりしないでください。

#### 最後にサインインする

```sh
gws auth login --scopes https://www.googleapis.com/auth/drive.readonly
```

ブラウザが開きます。「このアプリは Google で確認されていません」と出たら、それは自分で作ったテストモードのアプリなので **続行** を押します。duet-send は読むだけなので、Drive の読み取り専用（`drive.readonly`）でサインインします。`--scopes` は完全なURLで指定します。`drive.readonly` は Drive のすべてのファイルを読める権限です（書き込みはできません）。

あとで `gws` のコマンドが `accessNotConfigured`（「Google Drive API has not been used in project ...」）で失敗したら、そのプロジェクトで Drive API が無効です。`gws` が表示するリンク（または上の B1）から有効にし、数秒待ってからやり直します。gcloud があれば、`gcloud services list --enabled --project <PROJECT_ID>` に `drive.googleapis.com` があるかでも確かめられます。

設定はこれだけです。duet-send は **自分の** マイドライブ直下から `duet-coordinator-session-id.txt` を探して、その説明欄を読みます。説明欄が空のときは、代わりにファイルの本文をダウンロードします。サブフォルダにあるファイルや、他人から共有されたファイルは無視します。`DUET_DRIVE_FILE_ID`（手順6）を設定すると、検索を省いてそのファイルを直接読みます。

いちばん簡単な確認は、手順7の dry run です。duet-send とまったく同じ検索をします。手で検索してみたいときは、使っているシェルに合わせて次のどれかを実行します（3つとも duet-send と同じ条件で検索します）。

macOS / Linux（zsh / bash）：

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
| `DUET_DISCORD_WEBHOOK` | 送信そのものに失敗したら（IDが古いときなど）Discord に知らせてほしいとき。通知されず stderr に出るだけなのは、IDを読めなかったとき（`gws` のエラー、キーチェーンのロック）、`claude` が見つからないとき、本文が長すぎるとき、hook の60秒タイムアウトです。hook として動くときは stderr を見る人がいないので、これらは気づかれずに失敗します |
| `DUET_TAG` | 既定のタグを `[Claude Code]` 以外にしたいとき。`--hook` では使われません（hook のタグは `[Claude Code: Stop]` で、変えるときは `--tag`） |
| `DUET_CLAUDE_BIN` / `DUET_GWS_BIN` | `claude` / `gws` が PATH にないとき、または定期実行するとき（手順8） |
| `DUET_SESSION_ID` | 最後の手段。IDそのもの（コーディネーターが変わると古くなります） |

macOS（zsh）：`~/.zshrc` に次のような行を足して、新しいターミナルを開きます。Linux では、使っているシェルのファイル（たいていは `~/.bashrc`）に足します。

```sh
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows：PowerShell で次を実行して、新しいターミナルを開きます。

```powershell
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 7. 動作を確認する

下の dry run で確かめられるのは、duet-send がIDを **読めるか** までです。そのIDがまだ有効かは分かりません。コーディネーターが入れ替わって説明欄が古いIDのままだと、dry run は成功し、実際の送信が「archived」や「Session not found」で失敗します。そのときは Duet を開いてコーディネーターに何か話しかけてください。コーディネーターは起動時に自分のIDを確かめて説明欄を書き換えるので、そのあとでもう一度送ります。

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

「archived」や「Session not found」で失敗したときは、IDが古くなっています（この手順の最初を参照）。Duet でコーディネーターに話しかけ、説明欄が書き換わるのを待ってから、もう一度送ってください。

Stop hook（手順9）をすでに設定していて、このテストを Claude Code から実行すると、その Claude Code のターンが終わったときに `[Claude Code: Stop]` のメッセージがもう1通届きます。テストのコマンドの前に `DUET_HOOK=1` を付けても止まりません。hook を起動するのはあなたのコマンドではなく Claude Code だからです。避けたいときは、その Claude Code を `DUET_HOOK=1 claude` で起動してください（手順9を参照）。

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

- `bun` のフルパス。`which bun`（macOS、Linux）か `(Get-Command bun).Source`（PowerShell）で確かめます。場所は Bun の入れ方で変わり、公式のインストーラーなら `~/.bun/bin/bun`、`%USERPROFILE%\.bun\bin\bun.exe` です
- `DUET_CLAUDE_BIN` に `claude`（または `claude.exe`）のフルパス
- `DUET_GWS_BIN` に `gws` のフルパス
- `DUET_DISCORD_WEBHOOK` など、使っているほかの変数

macOS の crontab の例（`you` やパスは自分のものに置き換えてください。Linux ではホームフォルダが `/home/you` の下になります）：

```sh
0 9 * * * DUET_CLAUDE_BIN=/Users/you/.local/bin/claude /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --tag "[cron]" "おはようございます" >> /tmp/duet-send.log 2>&1
```

ジョブは `claude auth login` と `gws auth login` をしたのと同じユーザーで動かしてください。

**macOS では**、ログアウト中や、ログイン中のセッションの外で動くジョブは、ログインキーチェーンがロックされていることがあります。ロックされている間、duet-send は `gws` を呼びません。`DUET_SESSION_ID` を設定していればそれを使い、なければエラーで止まります（Discord には通知されません）。トラブルシューティングの「the macOS login keychain is locked」を見てください。

## 9. 任意：Claude Code が作業を終えたらコーディネーターに知らせる（Stop hook）

Claude Code には、応答を終えるたびにコマンドを実行する仕組みがあります。これを [Stop hook](https://code.claude.com/docs/ja/hooks#stop) と呼びます。duet-send に `--hook` を付けると、それをコーディネーターへの短いメッセージに変えるので、手元の Claude Code が終わったことが Duet に伝わります。

コーディネーターには、次のようなメッセージが届きます。

```
[Claude Code: Stop] Claude Code finished responding in my-project.

Last message:
I've fixed the failing test and pushed the branch. ...
```

中身は、Claude Code が作業していたフォルダの名前（フルパスではありません）と、Claude の最後の返答です。メッセージ全体は、ほかの duet-send のメッセージと同じく8,000文字までです。返答には最初の行の残りの分をすべて使い、それより長いときはそこで `…` を付けて切ります。

### 動くとき、動かないとき

- **Claude が応答を終えるたびに** 動きます。タスク全体が終わったときだけではありません。短い返事や、Claude があなたに質問して止まったときにも送られます。1ターンごとに1通届くと考えてください。
- あなたが Esc で中断したときは **動きません**。API のエラー（利用上限やサインインの問題など）でターンが終わったときは、代わりに `StopFailure` が動きます（下の「エラー用の2つ目の設定」を参照）。
- ターンの途中で Claude Code を閉じた・落ちたとき、パソコンがオフラインのとき、`claude` がサインインしていないときは送られません。`claude -p ... --cloud` 自体が失敗し、`DUET_DISCORD_WEBHOOK` を設定していれば、いつもどおり Discord に知らせます（通知にもネットワークが必要です）。それより前の問題（IDを読めなかったときなど）と60秒のタイムアウトは stderr に出るだけで、hook では誰の目にも触れません。
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
- `"async": true` にすると、Claude Code は送信を待たずに先へ進みます。duet-send は長くても60秒で自分から終わります。
- `--hook` のとき、duet-send は必ず終了コード0で終わり、問題は stderr にだけ書きます。Claude Code を止めたり、Claude に作業を続けさせたりすることはありません。
- Stop には `"matcher"` はいりません。

**`claude -p`（非対話モード）の終わりにも知らせたいとき：** `claude -p` が終了するときに動いている async の hook は Claude Code が打ち切るので、メッセージが送られないことがあります。`"async": true` を外して、代わりに `"timeout": 90` を書いてください。Claude Code は送信（ふつう数秒）を待ってから終了します。

**エラー用の2つ目の設定（任意）。** API のエラーでターンが終わったときにも知りたいなら、`"Stop"` の隣に `"StopFailure"` を足し、同じ `"hooks"` の中身を書きます。メッセージには（エラーの種類がわかるときは）その種類が入ります。

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

## トラブルシューティング

**`gws (Google Workspace CLI) was not found`**
`gws` を入れて（手順4）、新しいターミナルを開いてください。定期実行のときや、`gws` が PATH にないときは、`DUET_GWS_BIN` にフルパスを設定してください。

**`could not get the session id: gws failed (see above)`**
`gws` は入っているものの、IDを取れませんでした。理由はこの行のすぐ上に出ています。次の項目を見てください。

**`both the description and the content of Drive file ... are empty`**
コーディネーターがまだIDを書いていません。今のセッションIDをファイルの説明欄に書くよう頼んでください。

**`gws could not search Drive ...`、`gws could not read Drive file ...` または `gws could not download the file ...` に `invalid_grant`、`error[auth]`、`401` が含まれる**
`gws` のサインインが切れたか、取り消されています（テストモードでは7日ごとに切れます。B2 を参照）。`gws auth login --scopes https://www.googleapis.com/auth/drive.readonly` をもう一度実行してから、やり直してください。手順4を飛ばした（ほかのツール用に `gws` を設定済みだった）場合は、代わりに前と同じスコープでサインインしてください。`drive.readonly` だけにするのは、`gws` を duet-send だけで使う場合です。

**`the macOS login keychain is locked, so gws was not run`**
`gws` はサインイン情報の鍵をログインキーチェーンに置いていて、キーチェーンを読めないと保存したサインイン情報を消してしまいます。そのため duet-send は、キーチェーンがロックされている間は `gws` を呼びません。Mac にログインする（画面のロックを解除する）か、そのセッションで `security unlock-keychain` を実行してから、やり直してください。SSH 経由やバックグラウンドのジョブでは、代わりに `DUET_SESSION_ID` を設定してください。その場合は `gws` を呼ばずにそのIDを使います。

**`gws auth login` のあとも `Request had insufficient authentication scopes` が出る**
`gws` がどこかでサインイン情報を失い、Drive の権限がない gcloud のアプリケーションのデフォルト認証情報（ADC）を使ったうえ、そのトークンを保存しています。`gws auth status` を実行し、`auth_method` が `none` なら `gws auth login --scopes https://www.googleapis.com/auth/drive.readonly` を実行してください（ほかのツールでも `gws` を使っているなら、前と同じスコープでサインインします）。`oauth2` で Drive のスコープがあるなら、`~/.config/gws/token_cache.json`（ただのキャッシュで、作り直されます）を削除してからやり直してください。

**`gws found no duet-coordinator-session-id.txt in the root of your My Drive`**
ファイルがない、サブフォルダにある、または別のアカウントが持ち主になっています。コーディネーターにマイドライブ直下へ作ってもらうか、`DUET_DRIVE_FILE_ID` を設定してください。

**`warning: found 2 files named duet-coordinator-session-id.txt`**
これは警告だけで、処理は一番新しいファイルを使って続きます。消したいときは、古いものをドライブから削除するか、`DUET_DRIVE_FILE_ID` を設定してください。

**`... does not contain a session id`**
説明欄（本文を読んだ場合はファイルの中身）は、`session_`（または `cse_`）で始まるIDだけでなければいけません。コーディネーターに書き直してもらってください。メッセージに「the description of Drive file」とあれば、説明欄に別のものが入っています。ドライブでファイルの詳細を開くと確認できます。

**`cloud session session_… is archived and cannot accept new messages` または `Session not found`**
コーディネーターが入れ替わったのに、ファイルが古いIDのままです。Duet を開いて何か話しかけてください。新しいコーディネーターは起動時に自分のIDを確認し、ファイルの説明欄を書き換えます。1時間ごとの合図を設定している場合は、1時間ほどで自動的に直ります。（直らないときは、定期実行のプロンプトを見直すようコーディネーターに頼んでください。以前の版は定期実行の中でIDを確かめる作りで、黙って失敗していました。）`DUET_SESSION_ID` を使っている場合は、その値を更新してください。

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
