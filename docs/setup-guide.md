English | [日本語](setup-guide.ja.md)

# duet-send setup guide

This guide installs duet-send on macOS, Linux or Windows. It is written so that a person can follow it, and so that Claude Code can follow it on the user's behalf.

> **For Claude Code:** work through the steps in order and run the check at the end of each step. Install software only with the official commands shown here. Don't write to the user's shell profile or environment variables, don't send a real message (step 6), and don't edit Claude Code's settings files (optional step 8), until the user says yes. duet-send shortens session ids in its output; don't run it with `--verbose`, and don't print, copy or store a full session id anywhere.
>
> Some steps can't be done from Claude Code, because they wait for a person. Tell the user up front that these are theirs, and stop and hand them over when you reach one:
>
> - anything that asks for a password or a confirmation in the terminal: `sudo`, and `yay` or other AUR helpers (they ask to review and confirm the build)
> - signing in through a browser: `claude auth login` (step 3)
> - sharing the routes file by link (step 0): the user does it in Google Drive
>
> The user can run a short command that needs no input in this session by typing it after `!` at the prompt. Commands that wait for input (a password, a prompt, a browser sign-in) are best run in a separate terminal window; then the user tells you when they are done, and you run the step's check.

## How it fits together

```
your script / bot / Claude Code
        │  bun run duet "message"
        ▼
   duet-send ── reads ──▶ the routes file's name (Google Drive, shared by link)
        │
        │  claude -p "[tag] message" --cloud <session id>
        ▼
 Claude Duet coordinator (a cloud Claude Code session)
```

The coordinator keeps its session id in a routes table: one line of JSON that is the **file name** of one file in your Google Drive. It renames the file whenever its id changes (see [DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md)). It uses the name because Claude's Google Drive connector can change a file's name but not its content. The file is shared as "Anyone with the link" with the Viewer role. duet-send requests `https://drive.google.com/uc?export=download&id=<FILE_ID>` with plain HTTPS and no sign-in, and reads only the file name from the response (never the content), 15 seconds at most. The table looks like this:

```json
{"version":1,"updated_at":"2026-11-23T03:30:00Z","default":"main","routes":{"main":"session_..."}}
```

`default` is the route used when none is chosen; `--to <route>` picks another one (see step 7). `main` is the coordinator itself. `updated_at` is optional and only shown by `--dry-run`.

## 0. Before you start

- **The routes file must exist first.** Give the link to this repository to your Duet coordinator and ask it to set up duet-send. It creates a `duet-send` folder in your Google Drive with the routes file (and a short README explaining the folder), and tells you its **Drive file id** (the part after `/d/` in the file's link, or the `id=` value). Then, in Drive, open the routes file (not the folder), choose **Share → General access** and choose **Anyone with the link**, with the role **Viewer**. Never Editor or Commenter: anyone who can edit the file can rename it and redirect your messages. Keep the id to yourself and don't commit it.
- You need a Claude plan with Claude Code and cloud sessions (Pro, Max, Team, or Enterprise with the right seat). Sending with `--cloud` requires signing in with your Claude account; it doesn't work with an API key alone or with Amazon Bedrock, Google Vertex AI or other third-party providers.
- After installing anything in the steps below, **open a new terminal** before running the next command, so the new program is found.

To see what is already installed, run these one at a time (one that is missing prints "command not found"; that's fine):

```sh
git --version
bun --version
claude --version
claude auth status
```

`claude auth status` shows whether Claude Code is signed in. Skip the steps for what you already have, but still run each step's check.

## 1. Install git (or download a ZIP)

Check whether git is there:

```sh
git --version
```

If it isn't:

- macOS: run `xcode-select --install` and follow the dialog.
- Linux: use your distribution's package manager, for example `sudo pacman -S git` (Arch) or `sudo apt install git` (Debian, Ubuntu).
- Windows (PowerShell): `winget install --id Git.Git -e`, or download it from [git-scm.com](https://git-scm.com/downloads/win).

If you'd rather not install git, skip it: in step 4 you can download a ZIP instead.

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

## 4. Get duet-send

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

## 5. Set environment variables (only the ones you need)

| Variable | When you need it |
| --- | --- |
| `DUET_ROUTES_FILE_ID` | Always, unless you use `DUET_SESSION_ID` alone: the Drive file id of the routes file |
| `DUET_DISCORD_WEBHOOK` | You want a Discord alert when the send itself fails (for example a stale id), or when Claude Code can't be started (`claude` not found, or it fails to start). Not alerted, only printed to stderr: a routes file that can't be read, a message that is too long, and the 60 second hook timeout. In hook mode nobody sees stderr, so those fail silently |
| `DUET_TAG` | You want a default tag other than `[Claude Code]`. `--hook` doesn't use it (its tag is `[Claude Code: Stop]`; change that with `--tag`) |
| `DUET_CLAUDE_BIN` | `claude` isn't on PATH, or you run duet-send on a schedule (step 7) |
| `DUET_SESSION_ID` | The id itself. Used when `DUET_ROUTES_FILE_ID` is not set, and as a fallback (with a warning) when the routes file can't be read. It goes stale when the coordinator changes |

macOS (zsh): add lines like this to `~/.zshrc`, then open a new terminal. On Linux, use your shell's file instead (usually `~/.bashrc`).

```sh
export DUET_ROUTES_FILE_ID="<FILE_ID>"
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows: run this in PowerShell, then open a new terminal.

```powershell
[Environment]::SetEnvironmentVariable("DUET_ROUTES_FILE_ID", "<FILE_ID>", "User")
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 6. Check it works

The dry run below only checks that duet-send can **read** an id. It can't tell whether that id is still current: if the coordinator has been replaced and the routes file still holds the old id, the dry run passes and the real send fails with "archived" or "Session not found". When that happens, open Duet and say anything to the coordinator. It checks its own id when it starts and renames the routes file; then send again.

First a dry run. It finds the session id and `claude`, and prints what it would send, but sends nothing:

```sh
bun run duet --dry-run "duet-send test"
```

You should see something like this. The session id is shortened on purpose.

```
to: main (session_01Ab…xyz)
(read from: the routes file (Google Drive))
updated: 2026-11-23T03:30:00Z
claude: /Users/you/.local/bin/claude
message:
[Claude Code] duet-send test
```

`to:` shows the route and its id. `read from: the routes file (Google Drive)` is the normal case. `DUET_SESSION_ID` means the id came from that variable instead: it is not set up for the routes file, or the file couldn't be read (a warning on stderr says which). `updated:` is shown only when the routes table has `updated_at`.

If you see an error, go to Troubleshooting below.

Then send a real test message (Claude Code: ask the user first):

```sh
bun run duet "duet-send test. Please reply in the chat if this arrived."
```

`duet: sent to session_…` means Claude Code queued the message. Check your Duet chat for the coordinator's reply. Add `--verbose` only if you need the full session id or Claude Code's own output.

If it fails with "archived" or "Session not found", the id was stale (see the start of this step): talk to the coordinator in Duet, wait for it to rename the routes file, and send again.

If you already set up the Stop hook (step 8) and run this test from Claude Code, the coordinator gets a second message, `[Claude Code: Stop]`, when that Claude Code turn ends. Putting `DUET_HOOK=1` in front of the test command doesn't stop it, because Claude Code starts the hook, not your command. To avoid it, start that Claude Code session with `DUET_HOOK=1 claude` (see step 8).

## 7. Use it from your scripts and scheduled jobs

Call the script by its full path, with a tag that says who is sending:

```sh
bun /path/to/duet-send/send.ts --tag "[Nightly build]" "Build failed on main"
```

From a Node or Bun program, pass the message as an argument; don't build a shell command string:

```ts
import { execFile } from "node:child_process";
execFile("bun", ["/path/to/duet-send/send.ts", "--tag", "[Discord bot]", message]);
```

If the routes table has more than one route, `--to <route>` sends to that route instead of the default one, for example `bun /path/to/duet-send/send.ts --to work --tag "[Nightly build]" "Build failed"`. With `--to`, duet-send never falls back to `DUET_SESSION_ID`; if the route can't be read, nothing is sent.

If the message may start with `-`, put `--` before it: `bun run duet -- "-5 tests failed"`. (The tag is always put in front, so the message can never be read as a flag by `claude`.)

**Scheduled runs (cron, launchd, Task Scheduler, a bot service).** These don't read `~/.zshrc` or your user PATH. Use full paths everywhere, and set the variables in the job itself:

- the full path to `bun`: check it with `which bun` (macOS, Linux) or `(Get-Command bun).Source` (PowerShell). It depends on how you installed Bun; the official installer uses `~/.bun/bin/bun` and `%USERPROFILE%\.bun\bin\bun.exe`
- `DUET_CLAUDE_BIN` set to the full path of `claude` (or `claude.exe`)
- `DUET_ROUTES_FILE_ID` set to the Drive file id of the routes file
- any other variables you use, such as `DUET_DISCORD_WEBHOOK`

Example crontab line on macOS (replace `you` and the paths with yours; on Linux, home folders are under `/home/you`):

```sh
0 9 * * * DUET_ROUTES_FILE_ID=<FILE_ID> DUET_CLAUDE_BIN=/Users/you/.local/bin/claude /Users/you/.bun/bin/bun /Users/you/duet-send/send.ts --tag "[cron]" "Good morning" >> /tmp/duet-send.log 2>&1
```

The job must run as the same user who ran `claude auth login`.

## 8. Optional: tell the coordinator when Claude Code finishes (Stop hook)

Claude Code can run a command each time it finishes responding. This is called a [Stop hook](https://code.claude.com/docs/en/hooks#stop). With `--hook`, duet-send turns that into a short message to your coordinator, so Duet hears about it when Claude Code on your computer is done.

What the coordinator receives looks like this:

```
[Claude Code: Stop] Claude Code finished responding in my-project.

Last message:
I've fixed the failing test and pushed the branch. ...
```

It holds the name of the folder Claude Code was working in (not the full path) and Claude's last reply. The whole message, not counting the tag, can be up to 8,000 characters (the same limit as any duet-send message), so the reply gets all the room left after the first line; a longer reply is cut off there with `…`.

### When it fires, and when it doesn't

- It fires **every time Claude finishes a response**, not only when a whole task is done. A quick answer, or Claude stopping to ask you something, also sends a message. Expect one message per turn.
- It does **not** fire when you interrupt Claude (Esc). When a turn ends because of an API error (rate limit, sign-in problem, and so on), Claude Code runs `StopFailure` instead; see the optional second entry below.
- Nothing is sent if Claude Code is closed or crashes in the middle of a turn, if your computer is offline, or if `claude` isn't signed in. When `claude -p ... --cloud` itself fails and `DUET_DISCORD_WEBHOOK` is set, you get the usual Discord alert (the alert also needs a network connection). The same goes when Claude Code can't be started at all (`claude` not found, or it fails to start). Problems before that, such as a routes file that can't be read, and the 60 second timeout only go to stderr, which nobody sees in hook mode.
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

The hook runs with Claude Code's environment, so the variables from step 5 apply when Claude Code was started after you set them. If you start Claude Code from the desktop app or an editor and the hook can't find `claude` or your other settings, add them to the `"env"` block of the same `settings.json`. Claude Code passes it to the programs it starts, hooks included:

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

## 9. Optional: other chats keep their own route

If you use several Duet chats, each chat has its own coordinator session with its own session id. Each coordinator needs to keep **its own route** in the same routes table, so `--to <route>` keeps working after any of them is replaced. Each chat's session id changes on its own schedule, and a coordinator learns its own current id only from `get_session`, so each chat keeps its own route current.

Do this once per other chat:

1. Ask your main coordinator for the Drive file id of the routes file, and decide a route name for the chat (for example `work`).
2. Paste this into that chat, with the two placeholders filled in:

```
Please add this chat's route to the duet-send routes table, and check your own session id every hour.
- The routes table is one line of JSON in the file name of a Google Drive file (file id: <ROUTES_FILE_ID>). This chat's route name is "<ROUTE_NAME>".
- Read your own session id with get_session (no session_id).
- Right before writing, read the file's current title and etag from its metadata, and change only "<ROUTE_NAME>" in routes and updated_at. Don't change any other route. Pass the etag you read to the update, and if it fails, read again and retry. Don't create a new file.
- After writing, read the file name back and check that it is valid JSON and holds your id.
- Create a routine that posts only one fixed line in this chat once an hour (for example: This is the scheduled signal for the session-id check.). When that line arrives, do the check above, and if the id hasn't changed, do nothing.
- Save the file id, the route name and the fixed line in memory.
```

3. Use it: `bun run duet --to <route> "message"`.

Several sessions write the same file name, so they must not overwrite each other. That is why the request tells each coordinator to read the title and etag right before writing, change only its own key, and pass the etag to the update. Drive then refuses the write if the file changed in between, and the coordinator reads again and retries. After writing, it reads the name back and checks that it is valid JSON.

### Skip the approval on every rename

By default, a coordinator asks you before each rename, so an hourly check stalls until you answer. Claude Duet has "rules" for this. In the chat, say in your own words, for example:

```
You don't need to ask me each time before renaming the duet-send routes file in Drive to update session ids.
```

Duet shows a rule card; accept it. A rule has to come from your own message in that chat: a coordinator can't create one from a relayed instruction, someone else's message or memory. If a channel's coordinator still stops to ask before the rename, send the same request in that channel yourself and accept the rule there.

## Upgrading from 0.2 (gws)

Version 0.3 no longer uses `gws`, the Drive file description or `duet-coordinator-session-id.txt`. To upgrade:

1. Ask your Duet coordinator to set up the routes file again (it follows [DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md)). Share the file by link as Viewer (step 0).
2. Set `DUET_ROUTES_FILE_ID` to the new file's Drive file id (step 5).
3. Remove `DUET_DRIVE_FILE_ID` and `DUET_GWS_BIN` if you set them. They are ignored now.
4. `gws` itself and the old `duet-coordinator-session-id.txt` are no longer needed. Remove them if nothing else uses them.

## Troubleshooting

**`no destination: set DUET_ROUTES_FILE_ID ...`**
Set `DUET_ROUTES_FILE_ID` (step 5) in the shell or job that runs duet-send, or set `DUET_SESSION_ID`.

**`DUET_ROUTES_FILE_ID does not look like a Google Drive file id`**
The value must be only the id (letters, digits, `-` and `_`), not the whole link. It is the part after `/d/` in the file's link, or the `id=` value.

**`could not read the routes file (HTTP ...). Check the file id, and that the file is shared as "Anyone with the link" with the Viewer role` or `Google returned a web page instead of the routes file. ...`**
Google didn't hand out the file: the file isn't shared by link (Google then answers with a sign-in page), or the id is wrong. In Drive, open **Share → General access**, choose **Anyone with the link** with the role **Viewer**, and check the id with the coordinator.

**`... is not valid JSON`**
The file's name isn't the one-line routes JSON. Someone may have renamed it by hand. Ask the coordinator to rename the file again. Drive may show the long name oddly; that's expected.

**`unknown route ...`, `"default" ... is not in "routes"` or `unsupported routes version ...`**
The routes table has a name that isn't in it, or a version this duet-send doesn't know. Ask the coordinator to fix the table, or update duet-send (`git pull`).

**`route "..." does not contain a session id`**
That route's value isn't a session id (it starts with `session_` or `cse_`). Ask the coordinator to rewrite it.

**`could not read the routes file (Google Drive): ...`**
The request to Google Drive failed before any answer came, usually because the network is down or a proxy or firewall blocks `drive.google.com` or `drive.usercontent.google.com`. Check your network and try again. If you set `DUET_SESSION_ID`, duet-send uses it with a warning.

**`timed out after 15 seconds reading the routes file`**
Google Drive didn't answer in time. Check your network and try again. If you set `DUET_SESSION_ID`, duet-send uses it with a warning.

**`cloud session session_… is archived and cannot accept new messages` or `Session not found`**
The coordinator has changed and the routes file still has the old id. Open Duet and say anything; the new coordinator checks its id when it starts and renames the routes file. If you set up the hourly wake signal, this fixes itself within about an hour. (If it doesn't, ask the coordinator to look at the routine's prompt: an older version had the routine check the id itself, which fails silently.) If you use `DUET_SESSION_ID`, update it.

**`Unable to get organization UUID` or "Cloud sessions need a claude.ai sign-in"**
Run `claude auth login` and sign in with your Claude account. An API key is not enough.

**`Cloud sessions are disabled by your organization's policy`**
On a Team or Enterprise plan, an organization owner has to allow cloud sessions in the Claude Code admin settings.

**`... is a .cmd file and cannot be called safely` (Windows)**
See the Windows note in step 3. The dry run checks this too.

**`claude was not found`**
Open a new terminal after installing, or set `DUET_CLAUDE_BIN` to the full path. In scheduled runs, always set it.

**Nothing arrives in Duet, but `duet: sent` was printed**
Make sure `claude` is signed in to the same Claude account as Duet (`claude auth status`), and that the id in the routes file is the coordinator's current one (ask the coordinator). The dry run's `read from:` line shows whether the id came from the routes file or from `DUET_SESSION_ID`.
