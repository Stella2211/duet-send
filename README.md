English | [日本語](README.ja.md)

# duet-send

Send a message from your own computer to your **Claude Duet** coordinator.

Claude Duet's coordinator runs as a cloud Claude Code session. Claude Code can already queue a message into a cloud session with `claude -p "message" --cloud <session id>`, but the coordinator's session id changes from time to time, and scripts don't know the new one. duet-send solves that small but annoying problem:

- The coordinator keeps its current session id in a one-line file, `duet-coordinator-session-id.txt`, in your Google Drive.
- duet-send reads that file and sends your message to the right session.
- If sending fails (for example because the id went stale), it can alert you on Discord.

Use it to let a build script, a Discord bot, a cron job or a local Claude Code session hand work to your Duet coordinator. Works on **macOS and Windows**.

```sh
bun run duet "The nightly build finished. 3 tests failed, please take a look."
```

## Quick start (let an AI do it)

Give the link to this repository to your AI assistants and ask them to set it up:

1. **In Claude Duet** (your main chat): "Set up duet-send from <repo link>." The coordinator follows [DUET_INSTRUCTIONS.md](DUET_INSTRUCTIONS.md). It asks before it writes the id file to your Google Drive, and asks whether you want an hourly check that the id is still valid.
2. **In Claude Code on your computer**: "Install duet-send from <repo link> by following docs/setup-guide.md." It installs Bun if needed, clones this repository and runs a dry run.

## Quick start (by hand)

You need [Bun](https://bun.com), the native [Claude Code](https://code.claude.com/docs/en/setup) signed in with `claude auth login`, and either Google Drive for desktop or the Google Workspace CLI (`gws`).

```sh
git clone <this repository> duet-send
cd duet-send
bun run duet --dry-run "hello"   # shows the target session and the message, sends nothing
bun run duet "hello"             # sends it
```

The full walkthrough for macOS and Windows is in the [setup guide](docs/setup-guide.md).

## Usage

```sh
bun run duet "message"
echo "a longer message" | bun run duet
bun run duet --tag "[Discord bot]" "message"
bun run duet --dry-run "message"
```

From another directory or another program, call the script directly:

```sh
bun /path/to/duet-send/send.ts --tag "[Backup job]" "Backup finished"
```

Every message starts with a tag (default `[Claude Code]`). Messages sent this way arrive in Duet without any sender information, so the tag is how the coordinator knows which script sent it.

## Where the session id comes from

duet-send uses the first one it finds:

1. `DUET_ID_FILE`: full path to the id file
2. The Google Drive for desktop folder: `duet-coordinator-session-id.txt` in **My Drive** (also `マイドライブ`)
3. The Google Workspace CLI (`gws`), downloading the file by its Drive file id (`DUET_DRIVE_FILE_ID`)
4. `DUET_SESSION_ID`: the id itself

## Environment variables (all optional)

| Variable | What it does |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | Drive file id of `duet-coordinator-session-id.txt`. Needed only for the `gws` route. |
| `DUET_ID_FILE` | Full path to the id file, if it isn't in the usual Drive folder. |
| `DUET_SESSION_ID` | The session id itself, as a last resort. |
| `DUET_TAG` | Default tag put in front of each message. Default: `[Claude Code]` |
| `DUET_DISCORD_WEBHOOK` | Discord webhook URL to alert when sending fails. |
| `DUET_CLAUDE_BIN` | Path to `claude` if it isn't on PATH. On Windows it must be `claude.exe`. |
| `DUET_GWS_BIN` | Path to `gws` if it isn't on PATH. |

## Good to know

- Only your own Claude account can send to your sessions, so the id file is not a password. Still keep it in your own Drive and don't share it.
- On Windows, duet-send refuses `claude.cmd` (the npm shim), because a message passed through `cmd.exe` could be mangled or run as a command. Install the native `claude.exe` instead.
- The message is limited to 8,000 characters, and control characters other than newline and tab are removed.
- Sending only queues the message. duet-send doesn't wait for the coordinator's answer; you'll see it in Duet.

## License

[MIT](LICENSE)
