English | [日本語](setup-guide.ja.md)

# duet-send setup guide

This guide installs duet-send on macOS, Linux or Windows. It is written so that a person can follow it, and so that Claude Code can follow it on the user's behalf.

> **For Claude Code:** work through the steps in order and run the check at the end of each step. Install software only with the official commands shown here. Don't write to the user's shell profile or environment variables, don't send a real message (step 7), and don't edit Claude Code's settings files (optional step 9), until the user says yes. duet-send shortens session ids in its output; don't run it with `--verbose`, and don't print, copy or store a full session id anywhere.
>
> Some steps can't be done from Claude Code, because they wait for a person. Tell the user up front that these are theirs, and stop and hand them over when you reach one:
>
> - anything that asks for a password or a confirmation in the terminal: `sudo`, and `yay` or other AUR helpers (they ask to review and confirm the build)
> - signing in through a browser: `claude auth login` (step 3), `gcloud auth login` and `gws auth setup` / `gws auth login` (step 4)
> - the Google Cloud Console pages in step 4: the consent screen, test users and the OAuth client
>
> The user can run a short command that needs no input in this session by typing it after `!` at the prompt. Commands that wait for input (a password, a prompt, a browser sign-in) are best run in a separate terminal window; then the user tells you when they are done, and you run the step's check.

## How it fits together

```
your script / bot / Claude Code
        │  bun run duet "message"
        ▼
   duet-send ── reads ──▶ the description of duet-coordinator-session-id.txt (Google Drive)
        │
        │  claude -p "[tag] message" --cloud <session id>
        ▼
 Claude Duet coordinator (a cloud Claude Code session)
```

The coordinator writes its own session id into the Drive file's **description** (the "Description" field in the file's details in Drive), and rewrites it there whenever its id changes (see [DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md)). It uses the description because Claude's Google Drive connector can change a file's description but not its content. duet-send only reads it. Files set up before this change, with the id only in the content, still work: when the description is empty, duet-send reads the content.

## 0. Before you start

- **The id file must exist first.** Give the link to this repository to your Duet coordinator and ask it to set up duet-send. When it's done, `duet-coordinator-session-id.txt` is in the root of your My Drive. The coordinator also tells you the file's Drive file id; you don't need it, but it can speed up the `gws` lookup.
- You need a Claude plan with Claude Code and cloud sessions (Pro, Max, Team, or Enterprise with the right seat). Sending with `--cloud` requires signing in with your Claude account; it doesn't work with an API key alone or with Amazon Bedrock, Google Vertex AI or other third-party providers.
- After installing anything in the steps below, **open a new terminal** before running the next command, so the new program is found.

To see what is already installed, run these one at a time (one that is missing prints "command not found"; that's fine):

```sh
git --version
bun --version
claude --version
claude auth status
gws --version
gcloud --version
```

`claude auth status` shows whether Claude Code is signed in. `gcloud` is only needed for the automatic setup in step 4. Skip the steps for what you already have, but still run each step's check.

## 1. Install git (or download a ZIP)

Check whether git is there:

```sh
git --version
```

If it isn't:

- macOS: run `xcode-select --install` and follow the dialog.
- Linux: use your distribution's package manager, for example `sudo pacman -S git` (Arch) or `sudo apt install git` (Debian, Ubuntu).
- Windows (PowerShell): `winget install --id Git.Git -e`, or download it from [git-scm.com](https://git-scm.com/downloads/win).

If you'd rather not install git, skip it: in step 5 you can download a ZIP instead.

## 2. Install Bun

macOS and Linux:

```sh
curl -fsSL https://bun.com/install | bash
```

Windows (PowerShell; Windows 10 version 1809 or later):

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

Open a new terminal, then check:

```sh
bun --version
```

## 3. Install Claude Code (native) and sign in

Skip the install if `claude --version` already works, but on Windows read the note below.

macOS and Linux:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

**Open a new terminal**, then sign in with your Claude account (the same account you use for Claude Duet):

```sh
claude auth login
claude --version
```

**Windows note.** duet-send needs the native `claude.exe`. The npm package (`npm install -g @anthropic-ai/claude-code`) puts a `claude.cmd` launcher on your PATH, and duet-send refuses to run it, because a message passed through `cmd.exe` could be mangled or run as a command. Check what `claude` resolves to:

```powershell
where.exe claude
```

If the first line ends in `.cmd`, either install the native version as shown above, or set `DUET_CLAUDE_BIN` to the full path of `claude.exe`. The native installer puts it here:

- PowerShell: `"$env:USERPROFILE\.local\bin\claude.exe"`
- Command Prompt: `%USERPROFILE%\.local\bin\claude.exe`

## 4. Install the Google Workspace CLI (`gws`)

duet-send reads the id file's description with `gws`, so it always gets the id the coordinator wrote last. `gws` is an open-source tool from the googleworkspace GitHub organization; it says it is not an officially supported Google product, and it is still before v1.0.

**If you already have `gws` and it can read your Drive, skip this step, and do not sign in again.** Check with `gws auth status`: `auth_method` should be `oauth2`, and the scopes should include `https://www.googleapis.com/auth/drive` or `https://www.googleapis.com/auth/drive.readonly`. Then the search command below ("To run the search by hand") or the dry run in step 7 should work. Signing in again with `gws auth login` replaces your current sign-in with the scopes you pick this time, so other tools that use `gws` may lose access to things beyond Drive, or lose write access.

Install it one of these ways:

```sh
brew install googleworkspace-cli                # macOS (or Linux) with Homebrew
winget install --id Google.WorkspaceCLI -e      # Windows
npm install -g @googleworkspace/cli             # any OS, including Linux; needs Node.js 18 or later
```

On Linux without Homebrew, use the npm line (on some systems `npm install -g` needs `sudo`). You can also download a prebuilt binary from the [gws releases page](https://github.com/googleworkspace/cli/releases) and put `gws` on your PATH.

### Sign in to Google

`gws` needs an OAuth client of its own, which lives in a Google Cloud project. Setting that up is the longest part of this guide; you only do it once. There are two ways:

- **A. Automatic, with the gcloud CLI.** `gws auth setup` creates or picks the project, turns on the APIs and offers to sign you in (answer `n`; see A3 below). It needs `gcloud` installed and signed in. The OAuth client itself still has to be created by hand in the Cloud Console; setup tells you when (B2 and B3 below).
- **B. By hand, in the Cloud Console.** No `gcloud` needed.

Use a **new project just for gws** rather than one you use for other things: the steps change its OAuth consent screen and the APIs it has turned on.

#### A. With gcloud

1. **Install gcloud.**
   - macOS, Windows, Debian / Ubuntu (Google's apt repository), Red Hat / Fedora, and other Linux (a tar.gz archive): follow Google's [Install the Google Cloud CLI](https://cloud.google.com/sdk/docs/install) page.
   - Arch Linux: the `google-cloud-cli` package in the AUR, for example `yay -S google-cloud-cli`. The AUR is community-maintained, not Google's.

   Open a new terminal and check with `gcloud --version`.
2. **Sign in to gcloud** (opens a browser):

   ```sh
   gcloud auth login
   ```

3. **Pick the project.** To make a new one, use the [Cloud Console](https://console.cloud.google.com/projectcreate) or `gcloud projects create <PROJECT_ID>`. Project ids are global, so pick one nobody else has, for example `duet-send-gws-` and a few random letters. Then run setup with it:

   ```sh
   gws auth setup --project <PROJECT_ID>
   ```

   At the end, setup asks "Run `gws auth login` now? [Y/n]". Answer `n` and sign in with the command under "Then sign in" below. With `Y`, you get the default, much wider scopes.

   Without `--project`, setup uses gcloud's current project and stops with "No GCP project configured" if there is none (`gcloud config set project <PROJECT_ID>` sets one).
4. **When setup says "Manual OAuth client setup required"** (or "OAuth client creation requires manual setup"), do B2 and B3 below in that project. Setup may already have created the consent screen; check that it is External and that you are a test user. Setup then asks for the client ID and client secret; paste them in. If setup stopped instead of asking, save the client JSON as in B3 and go on to `gws auth login`.

#### B. By hand, in the Cloud Console

Replace `<PROJECT_ID>` in the links with your project's id (create the project first at the [Cloud Console](https://console.cloud.google.com/projectcreate) if you don't have one).

1. **Turn on the Google Drive API** for the project: open `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=<PROJECT_ID>` and click **Enable** (if it says **Manage**, it's already on).
2. **Set up the OAuth consent screen**: open `https://console.cloud.google.com/apis/credentials/consent?project=<PROJECT_ID>`.
   - User type (audience): **External**. Leaving it in testing mode is fine.
   - App name: anything, for example `gws CLI`. Support email: your own address.
   - Under **Test users**, click **Add users** and add your own Google account. Without this, sign-in fails with "Access blocked".
3. **Create the OAuth client**: open `https://console.cloud.google.com/apis/credentials?project=<PROJECT_ID>`, then **Create credentials → OAuth client ID**.
   - Application type: **Desktop app** (another type gives `redirect_uri_mismatch` later). You don't need to enter a redirect URI.
   - In the dialog that follows, download the JSON and save it as `~/.config/gws/client_secret.json` (Windows: `%USERPROFILE%\.config\gws\client_secret.json`). Create the folder if it doesn't exist. This file is a credential: don't commit it or paste it anywhere.

#### Then sign in

```sh
gws auth login --scopes https://www.googleapis.com/auth/drive.readonly
```

duet-send only reads, so sign in with read-only Drive access (`drive.readonly`). Give `--scopes` the full URL. It opens a browser. If Google says "Google hasn't verified this app", that's your own testing-mode app: click **Continue**. Note that `drive.readonly` can read all of the files in your Drive (it cannot write).

If a later `gws` command fails with `accessNotConfigured` ("Google Drive API has not been used in project ..."), the Drive API is off in that project. Turn it on with the link `gws` prints (or B1 above), wait a few seconds and try again. With gcloud you can also check it with `gcloud services list --enabled --project <PROJECT_ID>` and look for `drive.googleapis.com`.

That's all duet-send needs. It searches the root of **your own** My Drive for `duet-coordinator-session-id.txt` and reads its description. If the description is empty, it downloads the file's content instead. Files in subfolders, and files other people shared with you, are ignored. If you set `DUET_DRIVE_FILE_ID` (step 6), it skips the search and reads that file directly.

The easiest check is the dry run in step 7, which runs exactly the same search. To run the search by hand, use the command for your shell (all three send the same query as duet-send):

macOS or Linux (zsh or bash):

```sh
gws drive files list --params "{\"q\":\"name = 'duet-coordinator-session-id.txt' and 'root' in parents and 'me' in owners and trashed = false\",\"fields\":\"files(id,description)\"}"
```

PowerShell 7.3 or later:

```powershell
gws drive files list --params '{"q":"name = ''duet-coordinator-session-id.txt'' and ''root'' in parents and ''me'' in owners and trashed = false","fields":"files(id,description)"}'
```

Windows PowerShell 5.1 (the default `powershell.exe`):

```powershell
gws drive files list --params '{\"q\":\"name = ''duet-coordinator-session-id.txt'' and ''root'' in parents and ''me'' in owners and trashed = false\",\"fields\":\"files(id,description)\"}'
```

You should see one file with its `id` and a `description` that starts with `session_` (if `description` is missing, the coordinator hasn't written it yet, and duet-send reads the content instead). The description is the full session id, so don't paste the output anywhere. If your shell still mangles the quotes, use the dry run instead.

## 5. Get duet-send

With git:

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
```

Without git: open https://github.com/Stella2211/duet-send, choose **Code → Download ZIP**, extract it, and open a terminal in the extracted folder.

duet-send has no runtime dependencies. `bun install` is optional; it only adds type definitions for editors.

Check that the script builds:

```sh
bun run check
```

## 6. Set environment variables (only the ones you need)

| Variable | When you need it |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | Only to skip the search by name |
| `DUET_DISCORD_WEBHOOK` | You want a Discord alert when the send itself fails (for example a stale id). Not alerted, only printed to stderr: an id that can't be read (a `gws` error, a locked keychain, `claude` not found), a message that is too long, and the 60 second hook timeout |
| `DUET_TAG` | You want a default tag other than `[Claude Code]`. `--hook` doesn't use it (its tag is `[Claude Code: Stop]`; change that with `--tag`) |
| `DUET_CLAUDE_BIN` / `DUET_GWS_BIN` | `claude` / `gws` isn't on PATH, or you run duet-send on a schedule (step 8) |
| `DUET_SESSION_ID` | Last resort: the id itself (it goes stale when the coordinator changes) |

macOS (zsh): add lines like this to `~/.zshrc`, then open a new terminal. On Linux, use your shell's file instead (usually `~/.bashrc`).

```sh
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows: run this in PowerShell, then open a new terminal.

```powershell
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 7. Check it works

The dry run below only checks that duet-send can **read** an id. It can't tell whether that id is still current: if the coordinator has been replaced and the description still holds the old id, the dry run passes and the real send fails with "archived" or "Session not found". When that happens, open Duet and say anything to the coordinator. It checks its own id when it starts and rewrites the description; then send again.

First a dry run. It finds the session id and `claude`, and prints what it would send, but sends nothing:

```sh
bun run duet --dry-run "duet-send test"
```

You should see something like this. The session id is shortened on purpose.

```
to: session_01Ab…xyz
(read from: gws (Google Drive, file description))
claude: /Users/you/.local/bin/claude
message:
[Claude Code] duet-send test
```

`read from:` says where the id came from: `file description` is the normal case. `file content` means the description is empty (ask the coordinator to fill it in).

If you see an error, go to Troubleshooting below.

Then send a real test message (Claude Code: ask the user first):

```sh
bun run duet "duet-send test. Please reply in the chat if this arrived."
```

`duet: sent to session_…` means Claude Code queued the message. Check your Duet chat for the coordinator's reply. Add `--verbose` only if you need the full session id or Claude Code's own output.

If it fails with "archived" or "Session not found", the id was stale (see the start of this step): talk to the coordinator in Duet, wait for it to update the description, and send again.

If you already set up the Stop hook (step 9) and run this test from Claude Code, the coordinator gets a second message, `[Claude Code: Stop]`, when that Claude Code turn ends. Putting `DUET_HOOK=1` in front of the test command doesn't stop it, because Claude Code starts the hook, not your command. To avoid it, start that Claude Code session with `DUET_HOOK=1 claude` (see step 9).

## 8. Use it from your scripts and scheduled jobs

Call the script by its full path, with a tag that says who is sending:

```sh
bun /path/to/duet-send/send.ts --tag "[Nightly build]" "Build failed on main"
```

From a Node or Bun program, pass the message as an argument; don't build a shell command string:

```ts
import { execFile } from "node:child_process";
execFile("bun", ["/path/to/duet-send/send.ts", "--tag", "[Discord bot]", message]);
```

If the message may start with `-`, put `--` before it: `bun run duet -- "-5 tests failed"`. (The tag is always put in front, so the message can never be read as a flag by `claude`.)

**Scheduled runs (cron, launchd, Task Scheduler, a bot service).** These don't read `~/.zshrc` or your user PATH. Use full paths everywhere, and set the variables in the job itself:

- the full path to `bun`: check it with `which bun` (macOS, Linux) or `(Get-Command bun).Source` (PowerShell). It depends on how you installed Bun; the official installer uses `~/.bun/bin/bun` and `%USERPROFILE%\.bun\bin\bun.exe`
- `DUET_CLAUDE_BIN` set to the full path of `claude` (or `claude.exe`)
- `DUET_GWS_BIN` set to the full path of `gws`
- any other variables you use, such as `DUET_DISCORD_WEBHOOK`

Example crontab line on macOS (replace `you` and the paths with yours; on Linux, home folders are under `/home/you`):

```sh
0 9 * * * DUET_CLAUDE_BIN=/Users/you/.local/bin/claude /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --tag "[cron]" "Good morning" >> /tmp/duet-send.log 2>&1
```

The job must run as the same user who ran `claude auth login` and `gws auth login`.

**On macOS**, a job that runs while you are logged out, or outside your logged-in session, may find the login keychain locked. While it is locked, duet-send does not call `gws`. If `DUET_SESSION_ID` is set, it uses that; if not, it stops with an error (no Discord alert). See "the macOS login keychain is locked" under Troubleshooting.

## 9. Optional: tell the coordinator when Claude Code finishes (Stop hook)

Claude Code can run a command each time it finishes responding. This is called a [Stop hook](https://code.claude.com/docs/en/hooks#stop). With `--hook`, duet-send turns that into a short message to your coordinator, so Duet hears about it when Claude Code on your computer is done.

What the coordinator receives looks like this:

```
[Claude Code: Stop] Claude Code finished responding in my-project.

Last message:
I've fixed the failing test and pushed the branch. ...
```

It holds the name of the folder Claude Code was working in (not the full path) and the first 500 characters of Claude's last reply (a longer reply is cut off with `…`).

### When it fires, and when it doesn't

- It fires **every time Claude finishes a response**, not only when a whole task is done. A quick answer, or Claude stopping to ask you something, also sends a message. Expect one message per turn.
- It does **not** fire when you interrupt Claude (Esc). When a turn ends because of an API error (rate limit, sign-in problem, and so on), Claude Code runs `StopFailure` instead; see the optional second entry below.
- Nothing is sent if Claude Code is closed or crashes in the middle of a turn, if your computer is offline, or if `claude` isn't signed in. When `claude -p ... --cloud` itself fails and `DUET_DISCORD_WEBHOOK` is set, you get the usual Discord alert. Problems before that (the id can't be read, or the 60 second timeout) only go to stderr.
- Sending only queues the message. The coordinator reads it the next time it runs.

So it is a reliable "a turn ended" signal while Claude Code is running normally, not a guarantee that every piece of work is reported.

### Where to put it

Use your **user settings**, so it works in every project on this computer:

- macOS and Linux: `~/.claude/settings.json`
- Windows: `%USERPROFILE%\.claude\settings.json`

To use it in one project only, put the same block in that project's `.claude/settings.local.json` instead. Don't put it in a project's shared `.claude/settings.json`: the paths only exist on your computer, and that file is committed and read by everyone who opens the project.

If the file already exists, add the `"hooks"` part to it instead of replacing the file. If it already has a `"hooks"` section, add the `"Stop"` entry inside it. If it already has a `"Stop"` list, add duet-send's entry to that list; don't replace the entries already there. Editing by hand is easy to get wrong, so on macOS and Linux you can let `jq` do it (see "Add it with jq" below).

`hooks/hooks.json` is the format for hooks bundled in a Claude Code [plugin](https://code.claude.com/docs/en/plugins/overview). For your own computer, `settings.json` is simpler; a plugin's `hooks/hooks.json` uses the same `{"hooks": {...}}` block, with an optional `"description"` beside it.

### First, find the two full paths

The hook needs the full path to `bun` and the full path to `send.ts`. Look them up on your computer instead of copying the examples below: where `bun` lives depends on how you installed it. The official installer puts it in `~/.bun/bin/`, but Homebrew, npm and version managers put it somewhere else.

macOS and Linux (run the second line in the duet-send folder):

```sh
which bun
echo "$PWD/send.ts"
```

Windows PowerShell (run the second line in the duet-send folder):

```powershell
(Get-Command bun).Source
(Resolve-Path .\send.ts).Path
```

In Command Prompt, `where.exe bun` shows the path to `bun` (use the line that ends in `.exe`).

Write the full paths exactly as printed. The hook starts `bun` without a shell, so `~`, `$HOME` and `%USERPROFILE%` would not be expanded. If Claude Code later can't start the `bun` you found (for example, because it is a launcher from a version manager), use the path that `bun -e "console.log(process.execPath)"` prints; that is the `bun` program itself.

### The entry

macOS and Linux (put your two paths in place of the examples):

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

Windows (in JSON, each `\` in a path is written `\\`):

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

### Add it with jq (macOS, Linux)

If `~/.claude/settings.json` already exists, this keeps a backup and appends the entry to `hooks.Stop`, leaving everything else as it was (including other Stop hooks). Put your two paths in the first two lines:

```sh
BUN=/Users/you/.bun/bin/bun
SEND=/Users/you/duet-send/send.ts
cp ~/.claude/settings.json ~/.claude/settings.json.bak && \
jq --arg bun "$BUN" --arg send "$SEND" \
  '.hooks.Stop += [{"hooks": [{"type": "command", "command": $bun, "args": [$send, "--hook"], "async": true}]}]' \
  ~/.claude/settings.json.bak > ~/.claude/settings.json
```

Run it once only: each run adds another entry. If something goes wrong, `cp ~/.claude/settings.json.bak ~/.claude/settings.json` puts the old file back. If the file doesn't exist yet, create it with the full block above instead.

About these settings:

- `"command"` with `"args"` makes Claude Code start `bun` directly, without a shell, so paths with spaces need no quoting. On Windows this needs a real `.exe`, which `bun.exe` is.
- `"async": true` makes Claude Code carry on without waiting for the send. duet-send stops by itself after 60 seconds at most.
- In `--hook` mode duet-send always exits with code 0 and writes problems only to stderr, so it never stops Claude Code or makes Claude keep working.
- A Stop entry takes no `"matcher"`.

**If you run `claude -p` (non-interactive) and want a message at the end of those runs too:** Claude Code cancels async hooks that are still running when `claude -p` exits, so the message may not go out. Remove `"async": true` and add `"timeout": 90` instead. Claude Code then waits for the send, usually a few seconds, before it exits.

**Optional second entry for API errors.** To also hear when a turn ends because of an API error, add a `"StopFailure"` entry next to `"Stop"`, with the same `"hooks"` list. The message then says which error it was, when that is known.

### Environment variables for the hook

The hook runs with Claude Code's environment, so the variables from step 6 apply when Claude Code was started after you set them. If you start Claude Code from the desktop app or an editor and the hook can't find `claude` or your other settings, add them to the `"env"` block of the same `settings.json`. Claude Code passes it to the programs it starts, hooks included:

```json
{
  "env": {
    "DUET_CLAUDE_BIN": "/Users/you/.local/bin/claude"
  }
}
```

### Check it

1. Run the hook by hand, with exactly the two paths you wrote in `"command"` and `"args"`, and a sample of what Claude Code sends. This checks those paths and sends nothing.

   macOS and Linux:

   ```sh
   echo '{"hook_event_name":"Stop","cwd":"/tmp/test","last_assistant_message":"Test reply."}' | /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --hook --dry-run
   ```

   Windows PowerShell (the sample goes in on stdin, so no extra escaping is needed):

   ```powershell
   '{"hook_event_name":"Stop","cwd":"C:\\test","last_assistant_message":"Test reply."}' | & "C:\Users\you\.bun\bin\bun.exe" "C:\Users\you\duet-send\send.ts" --hook --dry-run
   ```

   In `--hook` mode the exit code is always 0, so read the output. A `message:` block starting with `[Claude Code: Stop]` means it works. A line starting with `duet:` says what is wrong.

2. In Claude Code, type `/hooks` and check that the `Stop` entry is listed under your user settings. Claude Code normally picks up edits to `settings.json` by itself; if it isn't listed, start a new session.
3. Ask Claude Code something short, then check Duet for the `[Claude Code: Stop]` message.

### Fewer messages, and loop safety

- To turn it off for one session, start Claude Code with `DUET_HOOK=1` set (for example `DUET_HOOK=1 claude`). duet-send then skips the hook.
- To use it only in some projects, put the entry in those projects' `.claude/settings.local.json` instead of your user settings.
- To tell computers apart, add a tag to `"args"`: `["/Users/you/duet-send/send.ts", "--hook", "--tag", "[Claude Code: Stop @MacBook]"]`.
- To remove it, delete the entry. There is no switch for one hook; `"disableAllHooks": true` turns off all of your hooks.

duet-send guards against loops by itself: it skips the hook when `stop_hook_active` is true (Claude is already continuing because of a Stop hook), and it marks the `claude` it starts with `DUET_HOOK=1`, so its own send can never trigger the hook again. Duet cloud sessions don't read your `~/.claude/settings.json`, so the coordinator's own turns don't trigger it either.

## Troubleshooting

**`gws (Google Workspace CLI) was not found`**
Install `gws` (step 4) and open a new terminal. In scheduled runs, or if `gws` isn't on PATH, set `DUET_GWS_BIN` to its full path.

**`could not get the session id: gws failed (see above)`**
`gws` is installed but couldn't get the id. The line above this one says why; see the next entries.

**`both the description and the content of Drive file ... are empty`**
The coordinator hasn't written its id yet. Ask it to write its current session id into the file's description.

**`gws could not search Drive ...`, `gws could not read Drive file ...` or `gws could not download the file ...` with `invalid_grant`, `error[auth]` or `401`**
Your `gws` sign-in has expired or was revoked. Run `gws auth login --scopes https://www.googleapis.com/auth/drive.readonly` again, then retry.

**`the macOS login keychain is locked, so gws was not run`**
`gws` keeps the key for its sign-in in your login keychain, and when it can't read that keychain it deletes its saved sign-in. So duet-send doesn't call it while the keychain is locked. Log in to the Mac (or unlock the screen), or run `security unlock-keychain` in that session, then retry. Over SSH or in a background job, set `DUET_SESSION_ID` instead; duet-send then uses it without calling `gws`.

**`Request had insufficient authentication scopes` right after `gws auth login`**
`gws` lost its sign-in at some point and used gcloud's Application Default Credentials, which have no Drive access. It also cached that token. Run `gws auth status`: if `auth_method` is `none`, run `gws auth login --scopes https://www.googleapis.com/auth/drive.readonly`. If it is `oauth2` with a Drive scope, delete `~/.config/gws/token_cache.json` (only a cache; it is recreated) and retry.

**`gws found no duet-coordinator-session-id.txt in the root of your My Drive`**
The file is missing, in a subfolder, or owned by another account. Ask the coordinator to create it in the root of your My Drive, or set `DUET_DRIVE_FILE_ID`.

**`warning: found 2 files named duet-coordinator-session-id.txt`**
This is only a warning: duet-send goes on with the newest file. To get rid of it, delete the old copies in Drive, or set `DUET_DRIVE_FILE_ID`.

**`... does not contain a session id`**
The description (or, for the content, the file) must hold only the id, starting with `session_` (or `cse_`). Ask the coordinator to rewrite it. If the message says "the description of Drive file", the description has something else in it; in Drive you can see it under the file's details.

**`cloud session session_… is archived and cannot accept new messages` or `Session not found`**
The coordinator has changed and the file still has the old id. Open Duet and say anything; the new coordinator checks its id when it starts and updates the file's description. If you set up the hourly wake signal, this fixes itself within about an hour. (If it doesn't, ask the coordinator to look at the routine's prompt: an older version had the routine check the id itself, which fails silently.) If you use `DUET_SESSION_ID`, update it.

**`Unable to get organization UUID` or "Cloud sessions need a claude.ai sign-in"**
Run `claude auth login` and sign in with your Claude account. An API key is not enough.

**`Cloud sessions are disabled by your organization's policy`**
On a Team or Enterprise plan, an organization owner has to allow cloud sessions in the Claude Code admin settings.

**`... is a .cmd file and cannot be called safely` (Windows)**
See the Windows note in step 3. The dry run checks this too.

**`claude was not found`**
Open a new terminal after installing, or set `DUET_CLAUDE_BIN` to the full path. In scheduled runs, always set it.

**Nothing arrives in Duet, but `duet: sent` was printed**
Make sure `claude` is signed in to the same Claude account as Duet (`claude auth status`), and that the id in the file's description is the coordinator's current one (ask the coordinator). The dry run's `read from:` line shows whether the id came from the description or the content.
