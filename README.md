English | [日本語](README.ja.md)

# duet-send

Send a message from your own computer to your **Claude Duet** coordinator.

Claude Duet's coordinator runs as a cloud Claude Code session. Claude Code can already queue a message into a cloud session with `claude -p "message" --cloud <session id>`, but the coordinator's session id changes from time to time, and scripts don't know the new one. duet-send solves that small but annoying problem:

- The coordinator keeps its current session id in the **description** of a file in your Google Drive, `duet-coordinator-session-id.txt`, and rewrites it whenever its id changes. (It uses the description because Claude's Google Drive connector can change a file's description but not its content.)
- duet-send reads that description and sends your message to the right session.
- If the send itself fails (for example because the id went stale), it can alert you on Discord.

Use it to let a build script, a Discord bot, a scheduled job or a local Claude Code session hand work to your Duet coordinator. Works on **macOS, Linux and Windows**.

```sh
bun run duet "The nightly build finished. 3 tests failed, please take a look."
```

## Why this exists

Claude Duet has no official, easy way to put a message into the coordinator from outside, such as a webhook. duet-send fills that gap with what is available today. We hope an official way arrives soon and makes this tool unnecessary.

> **Unofficial.** duet-send is a personal project. It is not made, endorsed or supported by Anthropic or Google. Sending uses only documented Claude Code features (`claude -p --cloud` and hooks), but the rest relies on how Claude Duet behaves today (late 2026), which may change without notice: that the coordinator is a cloud session `--cloud` can reach, that its session id changes when it is replaced, how the coordinator looks up its own id, and that messages arrive without sender information. If duet-send stops working, check these first.

## Quick start (let an AI do it)

Give the link to this repository to your AI assistants and ask them to set it up, in this order:

1. **In Claude Duet** (your main chat): "Set up duet-send from https://github.com/Stella2211/duet-send". The coordinator follows [DUET_INSTRUCTIONS.md](DUET_INSTRUCTIONS.md) and creates the id file. It asks before it writes to your Google Drive, and asks whether you want an hourly signal that wakes it to re-check its id.
2. **In Claude Code on your computer**: "Install duet-send from https://github.com/Stella2211/duet-send by following docs/setup-guide.md". It installs what's missing, downloads this repository and runs a dry run.

## Quick start (by hand)

**First, the id file must exist.** Ask your Duet coordinator to set itself up (step 1 above). Until it has written `duet-coordinator-session-id.txt` to your My Drive, duet-send has nothing to read.

You need:

- [git](https://git-scm.com/downloads), or download this repository as a ZIP instead (below)
- [Bun](https://bun.com)
- The native [Claude Code](https://code.claude.com/docs/en/setup), signed in with `claude auth login`
- The Google Workspace CLI (`gws`), signed in to the Google account that holds the id file

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
bun run duet --dry-run "hello"   # checks everything, sends nothing
bun run duet "hello"             # sends it
```

Without git: on the repository page, choose **Code → Download ZIP**, extract it, and open a terminal in the extracted folder.

The full walkthrough for macOS, Linux and Windows, including scheduled runs and troubleshooting, is in the [setup guide](docs/setup-guide.md).

## Usage

```sh
bun run duet "message"
echo "a longer message" | bun run duet
bun run duet --tag "[Discord bot]" "message"
bun run duet --dry-run "message"
bun run duet --verbose "message"
```

- `--dry-run` finds the session id and `claude`, prints what it would send, and sends nothing. It fails in the same places a real send would.
- `--tag` sets the label in front of the message (default `[Claude Code]`). Messages sent this way arrive in Duet without any sender information, so the tag is how the coordinator knows which script sent it.
- `--verbose` shows the full session id and Claude Code's own output. Without it, session ids are shortened (like `session_01Ab…xyz`) so they don't end up in logs or screenshots.

From another directory or another program, call the script by its full path:

```sh
bun /path/to/duet-send/send.ts --tag "[Backup job]" "Backup finished"
```

Optional: duet-send can also run as a Claude Code [Stop hook](https://code.claude.com/docs/en/hooks#stop) (`send.ts --hook`), so the coordinator hears about it each time Claude Code on your computer finishes a response. See [step 9 of the setup guide](docs/setup-guide.md#9-optional-tell-the-coordinator-when-claude-code-finishes-stop-hook).

## Where the session id comes from

duet-send uses the first one it finds:

1. The Google Workspace CLI (`gws`): it looks for the file in the root of your own My Drive (or uses `DUET_DRIVE_FILE_ID` if that is set) and reads the file's **description**. If the description is empty, it downloads the file's content instead, so files set up before the description was used keep working. Files other people shared with you are ignored.
2. `DUET_SESSION_ID`: the id itself.

On macOS, `gws` is not run while the login keychain is locked (for example over SSH or in a job outside your logged-in session). In that state `gws` would delete its saved sign-in, because the key for it is in that keychain. duet-send then uses `DUET_SESSION_ID` if it is set, and otherwise stops and asks you to unlock the keychain.

**Looking for a lighter way.** Today the session id is kept in Google Drive, but setting up `gws` is the heaviest part of installing duet-send, so we are looking for another way to hand over the id. If you know a good one, please tell us in an [issue](https://github.com/Stella2211/duet-send/issues).

## Environment variables (all optional)

| Variable | What it does |
| --- | --- |
| `DUET_DRIVE_FILE_ID` | Drive file id of `duet-coordinator-session-id.txt`, so `gws` can skip the search by name and read that file's description directly. |
| `DUET_SESSION_ID` | The session id itself, as a last resort. It goes stale when the coordinator changes. |
| `DUET_TAG` | Default tag put in front of each message. Default: `[Claude Code]`. Not used by `--hook`, whose tag is `[Claude Code: Stop]`; change it with `--tag`. |
| `DUET_DISCORD_WEBHOOK` | Discord webhook URL to alert when the send itself (`claude -p ... --cloud`) fails, for example a stale or archived id. Not alerted, only printed to stderr: failing to read the session id (a `gws` error, a locked keychain), `claude` not found, a message that is too long, and the 60 second hook timeout. Session ids in the alert are shortened. |
| `DUET_CLAUDE_BIN` | Full path to `claude`. On Windows it must be `claude.exe`. Set it for scheduled runs. |
| `DUET_GWS_BIN` | Full path to `gws`. Set it for scheduled runs. |
| `DUET_HOOK` | When `1`, `--hook` does nothing. duet-send sets it on the `claude` it starts, so its own send never triggers the hook. |

## Good to know

- Only your own Claude account can send to your sessions, so the id file is not a password. Still keep it in your own Drive and don't share it.
- On Windows, duet-send refuses `claude.cmd` (the npm launcher), because a message passed through `cmd.exe` could be mangled or run as a command. Install the native `claude.exe` instead.
- The message is limited to 8,000 characters. Line endings become `\n`, and other control characters except tab are removed.
- Sending only queues the message. duet-send doesn't wait for the coordinator's answer; you'll see it in Duet.

## License

[MIT](LICENSE)
