# NLK

## What NLK is

NLK is a personal assistant on Telegram. It runs on your own Mac, with your own Claude Pro account.

It can:
- chat with you in Thai or English
- remember things you tell it
- set reminders
- tell you the weather
- send an optional morning brief

It cannot send anything to anyone but you, install software, or read your passwords.

## ⚠️ Before you use it (KPMG)

- Check the KPMG IT policy before you use NLK.
- NLK is for personal use only.
- Never send client or work data to it. NLK will refuse and warn you, but anything you send has already passed through Telegram and Anthropic.
- Work email (Outlook) must never be connected.

## What you need

- A Mac that stays awake when you want NLK to answer. With the lid closed or the Mac asleep, NLK is offline. Reminders that fall due while the Mac sleeps fire when it wakes.
- A Claude Pro account.
- Telegram.
- A bot from @BotFather (see below).
- Homebrew. The installer offers to install the other tools it needs (Node 24, tmux, bun, Claude Code) and asks before it runs anything.

## Install

```
git clone <repo> && cd nlk-desk && ./install.sh
```

Create your bot first: in Telegram open @BotFather, send `/newbot`, pick a name and a username ending in `bot`, and keep the token it gives you.

The installer walks through nine steps and skips any that are already done, so it is safe to run again:

1. Checks the tools it needs and offers to install the missing ones.
2. Creates the `~/.nlk` folders and opens a Claude window: type `/login`, sign in with your Pro account, then `/exit`.
3. Installs the plugins into NLK's own Claude folder (`~/.nlk/claude`), separate from your normal Claude.
4. Asks for the BotFather token (hidden) and checks it with Telegram.
5. Asks you to send any message to your bot, then asks "Is this you?". Only you are allowed to talk to it.
6. Asks what NLK should call you, your city for weather, whether you want a morning brief and at what time, and whether to keep the Mac awake while charging.
7. Offers to open `persona.md` and `core.md` so you can edit them.
8. Starts NLK and sends you a hello on Telegram.
9. Prints a summary.

## Daily use

- Talk normally. Ask "remind me to call mum at 6pm" or "weather?".
- `/fresh` starts a clean conversation.
- Control NLK from the `nlk-desk` folder:
  - `./nlk status` shows whether it is running and whether Telegram is connected
  - `./nlk restart`
  - `./nlk stop`
  - `./nlk logs`
  - `./nlk backup` copies your memory and settings to `~/NLK-backups`
- To change its personality or house rules, edit `~/.nlk/desk/private/persona.md` and `core.md`, then run `./nlk restart`.

## Update

```
git pull && ./install.sh
```

## Uninstall

```
./uninstall.sh
```

Backups stay in `~/NLK-backups`. Afterwards, revoke the bot token in BotFather (`/revoke`).

## Cost on Claude Pro

NLK uses your normal Pro limits, shared with your own Claude use. Each message you send is one Claude turn. The morning brief is about one turn a day. When you hit the limit, NLK goes quiet until it resets. Anthropic does not publish fixed numbers, so there are none here. `./nlk status` shows whether NLK is running.

## Adding Gmail or Calendar later

1. Connect Gmail or Google Calendar on claude.ai, under the Pro account NLK uses.
2. Add the names of the read tools to `tools.allow` in `~/.nlk/config.json`.
3. Run `./nlk restart`.

NLK can then read and summarise, never send. Never connect work email.

## Troubleshooting

- **NLK does not answer.** Run `./nlk status`. Check that the Mac is awake (lid open, not asleep). Then try `./nlk restart`.
- **The installer prints "Claude Code … is newer than tested".** Send that line to whoever gave you NLK.
- **"Telegram channels are turned off for this Claude account's organization".** Your Claude account is managed by an organization that disables channels, so NLK cannot run on it. Use a personal Pro account.
- **Lost the bot token.** In BotFather send `/token` and pick your bot.
- **Pair again** (new phone or Telegram account): delete `~/.nlk/claude/channels/telegram-nlk/access.json` and run `./install.sh`.
