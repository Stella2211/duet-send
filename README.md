English | [日本語](README.ja.md)

# duet-send

Send a message from your own computer to your **Claude Duet** coordinator.

Claude Duet's coordinator runs as a cloud Claude Code session. Claude Code can already queue a message into a cloud session with `claude -p "message" --cloud <session id>`, but the coordinator's session id changes from time to time, and scripts don't know the new one. duet-send solves that small but annoying problem:

- The coordinator keeps its current session id in a small **routes table**: one line of JSON in the **file name** of one file in your Google Drive. It renames the file whenever its id changes. (It uses the name because Claude's Google Drive connector can change a file's name but not its content.)
- The file is shared as "Anyone with the link" with the **Viewer** role, so duet-send can read its name over plain HTTPS, with no Google sign-in. The file's content is a dummy and is ignored.
- duet-send reads the routes table and sends your message to the right session.
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

1. **In Claude Duet** (your main chat): "Set up duet-send from https://github.com/Stella2211/duet-send". The coordinator follows [DUET_INSTRUCTIONS.md](DUET_INSTRUCTIONS.md) and creates a `duet-send` folder in your Google Drive, with the routes file and a short README that explains the folder. It asks before it writes to your Google Drive, asks you to share the file by link (Viewer only), and tells you the file's Drive id. It also asks whether you want an hourly signal that wakes it to re-check its id.
2. **In Claude Code on your computer**: "Install duet-send from https://github.com/Stella2211/duet-send by following docs/setup-guide.md". It installs what's missing, downloads this repository, sets `DUET_ROUTES_FILE_ID` (with your OK) and runs a dry run.

## Quick start (by hand)

**First, the routes file must exist.** Ask your Duet coordinator to set itself up (step 1 above). It creates the file, you share it by link as Viewer, and it tells you the file's Drive id: the part after `/d/` in the file's link, or the `id=` value. Until then, duet-send has nothing to read.

You need:

- [git](https://git-scm.com/downloads), or download this repository as a ZIP instead (below)
- [Bun](https://bun.com)
- The native [Claude Code](https://code.claude.com/docs/en/setup), signed in with `claude auth login`

```sh
git clone https://github.com/Stella2211/duet-send.git
cd duet-send
export DUET_ROUTES_FILE_ID="<FILE_ID>"   # the Drive file id the coordinator gave you (Windows: see the setup guide)
bun run duet --dry-run "hello"   # checks everything, sends nothing
bun run duet "hello"             # sends it
```

Without git: on the repository page, choose **Code → Download ZIP**, extract it, and open a terminal in the extracted folder.

The full walkthrough for macOS, Linux and Windows, including scheduled runs and troubleshooting, is in the [setup guide](docs/setup-guide.md). Coming from 0.2 (the gws version)? See [Upgrading from 0.2](docs/setup-guide.md#upgrading-from-02-gws).

## Usage

```sh
bun run duet "message"
echo "a longer message" | bun run duet
bun run duet --tag "[Discord bot]" "message"
bun run duet --to work "message"
bun run duet --dry-run "message"
bun run duet --verbose "message"
```

- `--dry-run` finds the session id and `claude`, prints what it would send, and sends nothing. It fails in the same places a real send would.
- `--tag` sets the label in front of the message (default `[Claude Code]`). Messages sent this way arrive in Duet without any sender information, so the tag is how the coordinator knows which script sent it.
- `--to <route>` sends to that route of the routes table instead of its default route. It needs `DUET_ROUTES_FILE_ID`, and it never falls back to `DUET_SESSION_ID`: if the routes file can't be read or has no such route, nothing is sent. An unknown route lists the routes in the file.
- `--verbose` shows the full session id and Claude Code's own output. Without it, session ids are shortened (like `session_01Ab…xyz`) so they don't end up in logs or screenshots.

From another directory or another program, call the script by its full path:

```sh
bun /path/to/duet-send/send.ts --tag "[Backup job]" "Backup finished"
```

Optional: duet-send can also run as a Claude Code [Stop hook](https://code.claude.com/docs/en/hooks#stop) (`send.ts --hook`), so the coordinator hears about it each time Claude Code on your computer finishes a response. See [step 8 of the setup guide](docs/setup-guide.md#8-optional-tell-the-coordinator-when-claude-code-finishes-stop-hook).

## Where the session id comes from

The routes table is one line of JSON, and it is the **file name** of the routes file:

```json
{"version":1,"updated_at":"2026-11-23T03:30:00Z","default":"main","routes":{"main":"session_..."}}
```

- `routes` maps a route name to a session id. `main` is the coordinator itself. Other routes may be added.
- `default` names the route used when `--to` isn't given.
- `updated_at` is optional. It is only shown by `--dry-run`.

duet-send requests `https://drive.google.com/uc?export=download&id=<FILE_ID>` with plain HTTPS and no sign-in, and reads only the file name from the response's `Content-Disposition` header, never the content. It parses the name, from its first `{` to its last `}`, as the routes JSON, so an extension such as `.json` at the end of the name does no harm. If the file isn't shared by link, Google answers with a sign-in page, and duet-send tells you to check the id and the "Anyone with the link" / Viewer setting.

If you use several Duet chats, each chat's coordinator keeps its own route in the same table, and an approval rule in each chat avoids a stop at every rename. See [step 9 of the setup guide](docs/setup-guide.md#9-optional-other-chats-keep-their-own-route).

`DUET_SESSION_ID` is used when `DUET_ROUTES_FILE_ID` is not set. It is also a fallback, with a warning on stderr, when the routes file can't be read or parsed. With `--to`, there is no fallback. An unknown or invalid route always fails.

## Environment variables (all optional)

| Variable | What it does |
| --- | --- |
| `DUET_ROUTES_FILE_ID` | The Drive file id of the routes file: the part after `/d/` in its link, or the `id=` value. The coordinator tells you. |
| `DUET_SESSION_ID` | The session id itself. Used when `DUET_ROUTES_FILE_ID` is not set, and as a fallback (with a warning) when the routes file can't be read. It goes stale when the coordinator changes. |
| `DUET_TAG` | Default tag put in front of each message. Default: `[Claude Code]`. Not used by `--hook`, whose tag is `[Claude Code: Stop]`; change it with `--tag`. |
| `DUET_DISCORD_WEBHOOK` | Discord webhook URL to alert when the send itself (`claude -p ... --cloud`) fails, for example a stale or archived id, or when Claude Code can't be started (`claude` not found, or it fails to start). Not alerted, only printed to stderr: failing to read the routes file, a message that is too long, and the 60 second hook timeout. Session ids in the alert are shortened. |
| `DUET_CLAUDE_BIN` | Full path to `claude`. On Windows it must be `claude.exe`. Set it for scheduled runs. |
| `DUET_HOOK` | When `1`, `--hook` does nothing. duet-send sets it on the `claude` it starts, so its own send never triggers the hook. |

## Good to know

- Anyone who has the file id can read the route names and session ids, and can see your Google account name and email address (Google shows the owner of a shared file). They can't edit the file (Viewer only), and they can't send to your sessions, because sending needs your own Claude sign-in. Still, keep the id to yourself and don't commit it. Never share the file with edit access: anyone who can edit it can rename it and redirect your messages.
- On Windows, duet-send refuses `claude.cmd` (the npm launcher), because a message passed through `cmd.exe` could be mangled or run as a command. Install the native `claude.exe` instead.
- The message is limited to 8,000 characters. Line endings become `\n`, and other control characters except tab are removed.
- Sending only queues the message. duet-send doesn't wait for the coordinator's answer; you'll see it in Duet.

## License

[MIT](LICENSE)
