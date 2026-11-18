English | [日本語](setup-guide.ja.md)

# duet-send setup guide

This guide installs duet-send on macOS or Windows. It is written so that a person can follow it, and so that Claude Code can follow it on the user's behalf.

> **For Claude Code:** work through the steps in order and run the checks at the end of each step. Install software only with the official commands shown here. Don't write to the user's shell profile or environment variables, and don't send a real message (step 6), until the user says yes. Never print or store a session id anywhere except where this guide says.

## How it fits together

```
your script / bot / Claude Code
        │  bun run duet "message"
        ▼
   duet-send ── reads ──▶ duet-coordinator-session-id.txt (Google Drive)
        │
        │  claude -p "[tag] message" --cloud <session id>
        ▼
 Claude Duet coordinator (a cloud Claude Code session)
```

The coordinator writes its own session id into the Drive file (see [DUET_INSTRUCTIONS.md](../DUET_INSTRUCTIONS.md)). duet-send only reads it.

## 0. Before you start

- Ask your Duet coordinator to set itself up first: give it the link to this repository. When it's done, the file `duet-coordinator-session-id.txt` is in the root of your My Drive, and the coordinator tells you its Drive file id (optional; only the `gws` route can use it).
- You need a Claude plan with Claude Code and cloud sessions (Pro, Max, Team, or Enterprise with the right seat). Sending with `--cloud` requires signing in with your Claude account; it doesn't work with an API key alone or with Amazon Bedrock, Google Vertex AI or other third-party providers.

## 1. Install Bun

macOS:

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

## 2. Install Claude Code (native) and sign in

Skip the install if `claude --version` already works, but on Windows read the note below.

macOS:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Then sign in with your Claude account (the same account you use for Claude Duet):

```sh
claude auth login
claude --version
```

**Windows note.** duet-send needs the native `claude.exe`. The npm package (`npm install -g @anthropic-ai/claude-code`) puts a `claude.cmd` launcher on your PATH, and duet-send refuses to run it, because a message passed through `cmd.exe` could be mangled or run as a command. Check what `claude` resolves to:

```powershell
where.exe claude
```

If the first line ends in `.cmd`, either install the native version as shown above, or set `DUET_CLAUDE_BIN` to the full path of `claude.exe` (the native installer puts it in `%USERPROFILE%\.local\bin\claude.exe`).

## 3. Give duet-send a way to read the id file

Pick **one**.

### Option A: Google Drive for desktop (recommended)

Install [Google Drive for desktop](https://www.google.com/drive/download/) and sign in with the Google account that holds the id file. Both "stream" and "mirror" modes work.

duet-send looks in these places automatically:

- macOS: `~/Library/CloudStorage/GoogleDrive-*/My Drive/` (or `マイドライブ/`)
- Windows: `G:\My Drive\` (or `マイドライブ\`). If you changed the drive letter, it tries D through Z.

If your Drive folder is somewhere else, set `DUET_ID_FILE` to the full path of the file (step 5).

On macOS, the first time a terminal reads the Drive folder, macOS may ask whether the terminal may access Google Drive files. Allow it.

### Option B: Google Workspace CLI (`gws`)

Use this on machines without Drive for desktop. `gws` is an open-source tool from the googleworkspace GitHub organization; its README says it is not an officially supported Google product, and it is still before v1.0.

```sh
npm install -g @googleworkspace/cli    # on macOS, brew install googleworkspace-cli also works
gws auth setup                         # first time only; uses the gcloud CLI, or set up OAuth in the Cloud Console by hand
gws auth login -s drive
```

Note that the `drive` scope can read and write all of your Drive.

That's all duet-send needs: it searches the root of your own My Drive for `duet-coordinator-session-id.txt` (files other people shared with you are ignored) and downloads it. If you set `DUET_DRIVE_FILE_ID` (step 5), it skips the search and downloads that file directly.

To check that `gws` can see the file, run:

```sh
gws drive files list --params "{\"q\":\"name = 'duet-coordinator-session-id.txt' and trashed = false\"}"
```

In PowerShell 7.3 or later:

```powershell
gws drive files list --params '{"q":"name = ''duet-coordinator-session-id.txt'' and trashed = false"}'
```

In the older Windows PowerShell 5.1, the inner double quotes get lost; escape each `"` as `\"`.

You should see one file with its `id`. If `gws` prints an error, duet-send prints the same error, so fix that first (usually by running `gws auth login -s drive` again).

## 4. Get duet-send

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
```

duet-send has no runtime dependencies. `bun install` is optional; it only adds type definitions for editors.

Check that the script builds:

```sh
bun run check
```

## 5. Set environment variables (only the ones you need)

| Variable | When you need it |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | Option B (`gws`), only to skip the search by name |
| `DUET_ID_FILE` | The id file isn't in the usual Drive folder |
| `DUET_DISCORD_WEBHOOK` | You want a Discord alert when sending fails |
| `DUET_TAG` | You want a default tag other than `[Claude Code]` |
| `DUET_CLAUDE_BIN` / `DUET_GWS_BIN` | `claude` / `gws` isn't on PATH |
| `DUET_SESSION_ID` | Last resort: the id itself (it goes stale when the coordinator changes) |

macOS (zsh): add lines like this to `~/.zshrc`, then open a new terminal.

```sh
export DUET_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
```

Windows: run this in PowerShell, then open a new terminal.

```powershell
[Environment]::SetEnvironmentVariable("DUET_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...", "User")
```

## 6. Check it works

First a dry run. It finds the id and prints the target and the message, but sends nothing:

```sh
bun run duet --dry-run "duet-send test"
```

You should see `to: session_...`, `read from: ...` and the message with its tag. If you see an error, go to Troubleshooting below.

Then send a real test message (Claude Code: ask the user first):

```sh
bun run duet "duet-send test. Please reply in the chat if this arrived."
```

`duet: sent` means Claude Code queued the message. Check your Duet chat for the coordinator's reply.

## 7. Use it from your scripts

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

## Troubleshooting

**`duet-coordinator-session-id.txt was not found`**
Drive for desktop isn't running, isn't signed in, or the folder is somewhere else. Check that the file exists in My Drive in your browser, wait for Drive to sync, or set `DUET_ID_FILE` to the full path. For the `gws` route, read the `gws` error printed above this message.

**`... does not contain a session id`**
The file must hold exactly one line starting with `session_` (or `cse_`). Ask the coordinator to rewrite the file.

**`cloud session <id> is archived and cannot accept new messages` or `Session not found`**
The coordinator has changed and the file still has the old id. Open Duet and say anything; the new coordinator checks its id when it starts and asks you before updating the file. If you set up the hourly check, this fixes itself within about an hour. If you use `DUET_SESSION_ID`, update it.

**`Unable to get organization UUID` or "Cloud sessions need a claude.ai sign-in"**
Run `claude auth login` and sign in with your Claude account. An API key is not enough.

**`Cloud sessions are disabled by your organization's policy`**
On a Team or Enterprise plan, an organization owner has to allow cloud sessions in the Claude Code admin settings.

**`claude.cmd is a .cmd file and cannot be called safely` (Windows)**
See the Windows note in step 2.

**`claude was not found`**
Open a new terminal after installing, or set `DUET_CLAUDE_BIN` to the full path.

**`gws could not search Drive` or `gws could not download the file`**
The rest of the line is the error from `gws` itself. An `error[auth]` or `401` means `gws auth login -s drive` needs to be run again.

**`gws found no duet-coordinator-session-id.txt in the root of your My Drive`**
The file is missing, in a subfolder, or owned by another account. Ask the coordinator to create it in the root of your My Drive, or set `DUET_DRIVE_FILE_ID`.

**`found 2 files named duet-coordinator-session-id.txt`**
duet-send uses the newest one. Delete the old copies in Drive, or set `DUET_DRIVE_FILE_ID`.

**Nothing arrives in Duet, but `duet: sent` was printed**
Make sure `claude` is signed in to the same Claude account as Duet (`claude auth status`), and that the id in the file is the coordinator's current one (ask the coordinator).
