# Tiny Chat

A lightweight chat app that can do code, work, and conversation all in one place.
Seamlessly supporting everything from Claude and GPT to Grok and DeepSeek in one unified interface.
Improving on the chat experience with intuitive features like in-place editing, conversation branching, and transparent reasoning and tool calls.

## Features

#### Stay connected across devices

Chat on the web, or install on your desktop or mobile device. Conversations sync in real time through any platform you choose.

#### Never start from scratch again

Switch between models and providers at any point without losing a thing.
All models share the same chats, memory, and more.

#### Get help with your projects

Attach any GitHub repository to your chat. Models get smart overviews and powerful tools to fully explore and truly understand what you're working on.

#### Stay organized and up to date

Schedule anything. "Remind me to buy milk tomorrow at 5." "Give me a summary of the latest news each Tuesday and Thursday." All you have to do is ask.

#### Do everything in one place

Tiny Chat supports all modalities. Attach images, videos, PDFs, and more to your chats. Generate images, videos, and audio. All without switching chats.

## Installation

Builds are currently available for Windows, macOS, Linux, iOS, and Android. Download the [latest release](https://github.com/ryangarber/tiny-chat/releases) from the releases page.

Notes:

- On macOS, you may need to remove the quarantine attribute before you can open the app: `sudo xattr -d com.apple.quarantine /Applications/Tiny\ Chat.app`.
- On iOS, without a paid developer account, you may need to reinstall the app every 7 days. For a better experience, sideload the app using a tool like [SideStore](https://sidestore.io).

## Building

### Windows, macOS, and Linux

Test the app by running `pnpm run dev:desktop` (or `dev:desktop:dist` to load a build of the UI instead of using HMR).\
Build the app by running `pnpm run build:desktop`.

### iOS, Android

Test the app by running `pnpm run dev:[ios/android]` (or `dev:[ios/android]:dist`).\
Build the app by running `pnpm run build:[ios/android]`.

### Terminal

Test the CLI by running `pnpm run dev:cli`.\
Build the CLI by running `pnpm run build:cli`.

#### Editor shortcuts

The editor selects text with the mouse, by the character with Shift and an arrow, and by the word with Option, Shift and an arrow.

Terminals disagree on how much of a keypress they report. A modifier can only be seen if the terminal encodes it, and the legacy encoding has no room for every combination — so where a terminal cannot say that Shift was held, the app cannot know it was. Tiny Chat asks for the [kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) at startup, which reports every modifier apart; terminals that do not answer are left on the legacy encoding.

Everything works unaided in Ghostty, kitty, WezTerm, iTerm2, Alacritty, foot, Rio, Warp, and the VS Code terminal.

#### macOS Terminal

macOS Terminal implements neither the kitty protocol nor xterm's `modifyOtherKeys`, and its built-in key mappings cover Option and an arrow but not Option and Delete, or Option, Shift and an arrow — which it sends stripped of both modifiers. Turning on "Use Option as Meta Key", under Settings → Profiles → Keyboard, gives those two presses a shape of their own again: Option and Delete then deletes by the word, and Option, Shift and an arrow selects, a character at a time and up and down as well as along.

Selecting by the word needs the two presses to be mapped by hand, under Settings → Profiles → Keyboard → +:

| Key | Modifier | Action    | Text        |
| --- | -------- | --------- | ----------- |
| ←   | ⌥⇧       | Send Text | `\033[1;4D` |
| →   | ⌥⇧       | Send Text | `\033[1;4C` |

The rest works there as it comes: selecting by the character with Shift and an arrow, selecting with the mouse, and moving by the word with Option and an arrow. Selecting up and down with Shift alone is not possible, as Terminal maps no sequence for Shift and a vertical arrow.
