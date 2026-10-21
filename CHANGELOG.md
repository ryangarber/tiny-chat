## 0.10.2 (2026-10-21)

### Features

- legiscan provider ([5720bc2](https://github.com/ryangarber/tiny-chat/commit/5720bc2711288a55b08da5226512307d5a4d9964))
- new chat dashboard ([5720bc2](https://github.com/ryangarber/tiny-chat/commit/5720bc2711288a55b08da5226512307d5a4d9964))

### Performance Improvements

- various tui performance fixes ([1695a0a](https://github.com/ryangarber/tiny-chat/commit/1695a0a44b73b5b8c4478fa4599c7d490dfd1d15))

### Other

- migrate to rylease@v3 ([5720bc2](https://github.com/ryangarber/tiny-chat/commit/5720bc2711288a55b08da5226512307d5a4d9964))
- clean up workflows ([1b055e6](https://github.com/ryangarber/tiny-chat/commit/1b055e6544020dd5b232416eedc2ab65ef092047))

## 0.10.1 (2026-10-18)

### Features

- improved gestures, navigation on mobile ([71b72bf](https://github.com/ryangarber/tiny-chat/commit/71b72bf26e0f49afb2485f6f33ef52ef8588eb07))

### Bug Fixes

- fullscreen content escapes ios safe area ([71b72bf](https://github.com/ryangarber/tiny-chat/commit/71b72bf26e0f49afb2485f6f33ef52ef8588eb07))
- update manifests not created for cli ([71b72bf](https://github.com/ryangarber/tiny-chat/commit/71b72bf26e0f49afb2485f6f33ef52ef8588eb07))

## 0.10.0 (2026-10-18)

### Breaking Changes

- new desktop and mobile apps ([fa6057b](https://github.com/ryangarber/tiny-chat/commit/fa6057bf0dccd95855f6d6c91ffc8e7d3b817485))

### Features

- refreshed gui, tui designs ([fa6057b](https://github.com/ryangarber/tiny-chat/commit/fa6057bf0dccd95855f6d6c91ffc8e7d3b817485))
- fullscreen content preview in tui ([fa6057b](https://github.com/ryangarber/tiny-chat/commit/fa6057bf0dccd95855f6d6c91ffc8e7d3b817485))

### Bug Fixes

- ios clipboard, viewport improvements ([fa6057b](https://github.com/ryangarber/tiny-chat/commit/fa6057bf0dccd95855f6d6c91ffc8e7d3b817485))
- memories not available in temporary chat ([fa6057b](https://github.com/ryangarber/tiny-chat/commit/fa6057bf0dccd95855f6d6c91ffc8e7d3b817485))

### Other

- improved release pipeline ([fa6057b](https://github.com/ryangarber/tiny-chat/commit/fa6057bf0dccd95855f6d6c91ffc8e7d3b817485))
- bump dependencies [skip ci] ([dd30a38](https://github.com/ryangarber/tiny-chat/commit/dd30a385a64310b8dbd7b77325ea14225b1f2408))

## [0.9.8](https://github.com/RyanGarber/tiny-chat/compare/0.9.7...0.9.8) (2026-10-10)

### Features

* citations match by tool call id ([cc09626](https://github.com/RyanGarber/tiny-chat/commit/cc09626c6e19300fd3cbb8b88f7d5d065273615d-5))
* mcp server log viewer ([45de199](https://github.com/RyanGarber/tiny-chat/commit/45de199c8c7d94bf3d2c8462a8afcf1ef32e8f0b))
* native ctrl+f in tui, gui ([cc09626](https://github.com/RyanGarber/tiny-chat/commit/cc09626c6e19300fd3cbb8b88f7d5d065273615d-4))
* persisted subagent runs, citation support ([cc09626](https://github.com/RyanGarber/tiny-chat/commit/cc09626c6e19300fd3cbb8b88f7d5d065273615d))
* run shell commands from within chat ([cc09626](https://github.com/RyanGarber/tiny-chat/commit/cc09626c6e19300fd3cbb8b88f7d5d065273615d-3))

### Bug Fixes

* cannot scroll up streaming tool calls ([cc09626](https://github.com/RyanGarber/tiny-chat/commit/cc09626c6e19300fd3cbb8b88f7d5d065273615d-1))
* data from failed generations can be lost ([45de199](https://github.com/RyanGarber/tiny-chat/commit/45de199c8c7d94bf3d2c8462a8afcf1ef32e8f0b-4))
* invalid state caused by opening to a missing/unauthorized chat ([45de199](https://github.com/RyanGarber/tiny-chat/commit/45de199c8c7d94bf3d2c8462a8afcf1ef32e8f0b-5))
* some logs can pollute tui window ([45de199](https://github.com/RyanGarber/tiny-chat/commit/45de199c8c7d94bf3d2c8462a8afcf1ef32e8f0b-3))

### Performance Improvements

* full virtualization in chats ([45de199](https://github.com/RyanGarber/tiny-chat/commit/45de199c8c7d94bf3d2c8462a8afcf1ef32e8f0b-2))
* incremental rendering in tui ([45de199](https://github.com/RyanGarber/tiny-chat/commit/45de199c8c7d94bf3d2c8462a8afcf1ef32e8f0b-1))


## [0.9.7](https://github.com/RyanGarber/tiny-chat/compare/0.9.6...0.9.7) (2026-10-08)

### Features

* action editor ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27-1))
* consistent app, cli controls ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27-2))
* memory editor ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27))
* primary project folder falls back to first available ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27-3))

### Bug Fixes

* actions can run at inconsistent times ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27-6))
* autosave restarts mcp server on every argument edit ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27-5))

### Performance Improvements

* optimize file search, grep ([d3cf96c](https://github.com/RyanGarber/tiny-chat/commit/d3cf96cd41c39f179deaeb2c15c0e7236fccea27-4))


## [0.9.6](https://github.com/RyanGarber/tiny-chat/compare/0.9.5...0.9.6) (2026-10-07)

### Features

* wsl support ([68b9a75](https://github.com/RyanGarber/tiny-chat/commit/68b9a7589f1940a8d03913a3a50e6857959144b6))


## [0.9.5](https://github.com/RyanGarber/tiny-chat/compare/0.9.4...0.9.5) (2026-10-07)

### Features

* afm support in the cli ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-1))
* ctrl+c to copy selection in cli ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-9))
* improved markdown, editor node rendering ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-5))
* jump to message from citations ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-3))
* mcp server editor in cli ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-8))
* memory and action citations ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-2))
* project automatically activates when resuming chat ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-4))
* search jumps to exact message ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-12))

### Bug Fixes

* cache miss on later messages with multiple tool loops ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-6))
* cli properly cleans up before exiting ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-10))
* devtools connection delays app load ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-13))
* potential test failure due to test server race ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-11))

### Performance Improvements

* optimized walk, bulk file reads for git, skills ([bb9a783](https://github.com/RyanGarber/tiny-chat/commit/bb9a7836a8f47ad74a053252fac5367633b7786c-7))


## [0.9.4](https://github.com/RyanGarber/tiny-chat/compare/0.9.3...0.9.4) (2026-10-05)

### Features

* `--no-keyring` option in cli ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-2))
* completions wrapping in cli ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-3))
* improved cli config editor ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-5))
* improved cli focus display ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-1))
* improved cli panels ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2))
* improved tool execution loop ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-8))
* logic shell environment inheritance ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-6))

### Bug Fixes

* cli text boxes not filling width ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-7))

### Performance Improvements

* improve agentic coding prompting ([41c17cc](https://github.com/RyanGarber/tiny-chat/commit/41c17cca28f0b937b7da8b2d55f5bc370ea83cf2-4))


## [0.9.3](https://github.com/RyanGarber/tiny-chat/compare/0.9.2...0.9.3) (2026-10-04)

### Features

* commands for common settings ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-12))
* continue button for failed runs ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-6))
* expand agent and CLI workflows ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583))
* file viewer in cli ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-10))
* git diffs in file viewer ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-9))
* improved attachment search ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-5))
* improved auto approval ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-7))
* improved capability ui ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-4))
* improved citations ui ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-13))
* improved cli editor ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-14))
* improved project, config switching ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-11))
* multi-pane cli layout ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-8))
* parallel and background tools ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-3))
* shell timeouts and aborts ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-2))
* web browser tools ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-1))

### Bug Fixes

* ansi noise and no newlines in shell output ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-15))
* tool feedback not interactible in cli ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-16))

### Performance Improvements

* document subagent limitations in instructions ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-18))
* increase default tokens-in to 250,000 ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-17))
* wasm worker code highlighting, improved caching ([33f90dd](https://github.com/RyanGarber/tiny-chat/commit/33f90dd2f96bc864e90f580be516f834e6764583-19))


## [0.9.2](https://github.com/RyanGarber/tiny-chat/compare/0.9.1...0.9.2) (2026-09-30)

### Features

* customizable command, folder auto approval ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1-1))
* feature parity in cli settings menu ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1-3))
* improved completions ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1))
* redesigned tool call, result, feedback ui ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1-2))

### Bug Fixes

* subagent model selection not updating tool status ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1-6))
* tab not switching focused tool call in cli ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1-4))
* various app, cli fixes and improvements ([36f3374](https://github.com/RyanGarber/tiny-chat/commit/36f337490e1fa045be8447f872ca0620c00b67b1-5))


## [0.9.1](https://github.com/RyanGarber/tiny-chat/compare/0.9.0...0.9.1) (2026-09-27)

### Bug Fixes

* ios safe area insets not applying ([062cbf2](https://github.com/RyanGarber/tiny-chat/commit/062cbf21e37f0d15ec50f06e35e267da8dcaa7d9))


## [0.9.0](https://github.com/RyanGarber/tiny-chat/compare/0.8.6...0.9.0) (2026-09-27)

### ⚠ BREAKING CHANGES

* apple foundation models

### Features

* apple foundation models ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a))
* better command auto-approval ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-6))
* github tool display, source citations ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-7))
* improved completion sorting ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-8))
* skip file edit approvals in folder ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-5))

### Bug Fixes

* cli citation crash ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-4))
* editor doesn't collapse when deleting empty lines ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-10))
* tool definitions not counted in token estimation ([996da61](https://github.com/RyanGarber/tiny-chat/commit/996da611dbaf2e15aea1c92415863ca0de8c974a-11))


## [0.8.6](https://github.com/RyanGarber/tiny-chat/compare/0.8.5...0.8.6) (2026-09-24)

### Features

* dynamic per-message context ([33088d8](https://github.com/RyanGarber/tiny-chat/commit/33088d873b5af56b91fa433dc841c2ee4c13c97d))

### Bug Fixes

* thinking blocks can be rejected by anthropic ([33088d8](https://github.com/RyanGarber/tiny-chat/commit/33088d873b5af56b91fa433dc841c2ee4c13c97d-1))


## [0.8.5](https://github.com/RyanGarber/tiny-chat/compare/0.8.4...0.8.5) (2026-09-20)

### Bug Fixes

* add missing peer deps ([f76b17f](https://github.com/RyanGarber/tiny-chat/commit/f76b17fd08bf66c9b90ef1a3555422ce13cb4f74-1))
* just-bash fails under bun ([f76b17f](https://github.com/RyanGarber/tiny-chat/commit/f76b17fd08bf66c9b90ef1a3555422ce13cb4f74))


## [0.8.4](https://github.com/RyanGarber/tiny-chat/compare/0.8.3...0.8.4) (2026-09-20)

### Features

* app redesign ([84642b0](https://github.com/RyanGarber/tiny-chat/commit/84642b01c4a281c14269b30e61bcbc36f28ec14d-1))
* dreaming-based memory ([22645b9](https://github.com/RyanGarber/tiny-chat/commit/22645b9602315990ac9c3fec589397928faf1f2b))
* embedding workers ([e8d6353](https://github.com/RyanGarber/tiny-chat/commit/e8d6353c88ec0042ca25bf533324f990c39aa7cf-3))
* folders/projects ([84642b0](https://github.com/RyanGarber/tiny-chat/commit/84642b01c4a281c14269b30e61bcbc36f28ec14d))
* github research toolset ([e8d6353](https://github.com/RyanGarber/tiny-chat/commit/e8d6353c88ec0042ca25bf533324f990c39aa7cf-1))
* per-provider, per-mcp cache and refresh ([e8d6353](https://github.com/RyanGarber/tiny-chat/commit/e8d6353c88ec0042ca25bf533324f990c39aa7cf-2))
* revamped file list ([22645b9](https://github.com/RyanGarber/tiny-chat/commit/22645b9602315990ac9c3fec589397928faf1f2b-1))
* revamped paste handling ([22645b9](https://github.com/RyanGarber/tiny-chat/commit/22645b9602315990ac9c3fec589397928faf1f2b-2))
* rich cli markdown editor ([e8d6353](https://github.com/RyanGarber/tiny-chat/commit/e8d6353c88ec0042ca25bf533324f990c39aa7cf))

### Bug Fixes

* various fixes and improvements ([e8d6353](https://github.com/RyanGarber/tiny-chat/commit/e8d6353c88ec0042ca25bf533324f990c39aa7cf-8))
* various ui improvements ([22645b9](https://github.com/RyanGarber/tiny-chat/commit/22645b9602315990ac9c3fec589397928faf1f2b-3))

### Performance Improvements

* bounded folder attachment context ([e8d6353](https://github.com/RyanGarber/tiny-chat/commit/e8d6353c88ec0042ca25bf533324f990c39aa7cf-7))
* enable anthropic cache control ([22645b9](https://github.com/RyanGarber/tiny-chat/commit/22645b9602315990ac9c3fec589397928faf1f2b-6))
* enable react compiler ([22645b9](https://github.com/RyanGarber/tiny-chat/commit/22645b9602315990ac9c3fec589397928faf1f2b-5))


## [0.8.3](https://github.com/RyanGarber/tiny-chat/compare/0.8.2...0.8.3) (2026-08-25)

### Features

* cleaned, improved system prompt ([9ed423e](https://github.com/RyanGarber/tiny-chat/commit/9ed423e283b416b5a61ee262d380cae1701c6bae-1))
* streamlined shell tools ([9ed423e](https://github.com/RyanGarber/tiny-chat/commit/9ed423e283b416b5a61ee262d380cae1701c6bae))

### Bug Fixes

* clicking folder in chat file list opens viewer instead of expanding ([9ed423e](https://github.com/RyanGarber/tiny-chat/commit/9ed423e283b416b5a61ee262d380cae1701c6bae-3))
* folders in repos treated as files in chat file list ([9ed423e](https://github.com/RyanGarber/tiny-chat/commit/9ed423e283b416b5a61ee262d380cae1701c6bae-2))
* instructions missing in token counts with empty message ([9ed423e](https://github.com/RyanGarber/tiny-chat/commit/9ed423e283b416b5a61ee262d380cae1701c6bae-4))


## [0.8.2](https://github.com/RyanGarber/tiny-chat/compare/0.8.1...0.8.2) (2026-08-24)

### Features

* **app:** long pasted text node ([f699634](https://github.com/RyanGarber/tiny-chat/commit/f699634fb5a05cd1c565e03cf6cef3237fe5bcbe-1))
* improved file viewer ([f699634](https://github.com/RyanGarber/tiny-chat/commit/f699634fb5a05cd1c565e03cf6cef3237fe5bcbe-4))
* subagents ([f699634](https://github.com/RyanGarber/tiny-chat/commit/f699634fb5a05cd1c565e03cf6cef3237fe5bcbe))


## [0.8.1](https://github.com/RyanGarber/tiny-chat/compare/0.8.0...0.8.1) (2026-08-19)

### Features

* dynamic pdf, docx, xlsx extraction ([5443ba9](https://github.com/RyanGarber/tiny-chat/commit/5443ba981d47fb845c75c20a67df339973548635))
* improved file filtering ([3ca8c8a](https://github.com/RyanGarber/tiny-chat/commit/3ca8c8af1c73f463740ad6ace3225a12fa3bfc93))

### Bug Fixes

* user-content- shown in cli attachment node ([3ca8c8a](https://github.com/RyanGarber/tiny-chat/commit/3ca8c8af1c73f463740ad6ace3225a12fa3bfc93-2))


## [0.8.0](https://github.com/RyanGarber/tiny-chat/compare/0.7.9...0.8.0) (2026-08-18)

### ⚠ BREAKING CHANGES

* rewrite uploads, chat files system

### Features

* cleaner command/attachment nodes in cli editor ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-8))
* cli auto update ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-3))
* themes in cli ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b))
* uploads, repos in cli ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-7))

### Bug Fixes

* github clones save without a name ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-9))
* logs printed to console in cli builds ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-2))
* scroll views not triggering fetch of next page in cli ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-6))
* scroll views wrongly growing to fill space in cli ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-5))
* sixel causing runtime failure of cli in bun build ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-1))
* tool feedback memoization preventing controls from focusing in cli ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-4))

### Performance Improvements

* queries in app console ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-10))

### Code Refactoring

* rewrite uploads, chat files system ([0550018](https://github.com/RyanGarber/tiny-chat/commit/055001837348f98060ac2441a15b7d4631ca285b-11))


## [0.7.9](https://github.com/RyanGarber/tiny-chat/compare/0.7.8...0.7.9) (2026-08-16)

### Features

* dynamic approval, safe command whitelist ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-1))
* mobile support for hover menus in app ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-4))
* redesigned cli with full mouse support ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-3))
* redesigned, optimized code blocks, diffs, mermaid in app ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2))
* rewritten input in cli ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-7))
* rewritten scroll views in cli ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-6))

### Bug Fixes

* tabs causing layout issues in cli code blocks ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-2))

### Performance Improvements

* rewritten message renderer ([fe0582a](https://github.com/RyanGarber/tiny-chat/commit/fe0582a070986053a53c84bc47bb6e92c61fcde2-5))


## [0.7.8](https://github.com/RyanGarber/tiny-chat/compare/0.7.7...0.7.8) (2026-08-13)

### Features

* attached directories included as full tree ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-15))
* ctrl+c/ctrl+d exit handling in cli ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-12))
* custom cli markdown renderer ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54))
* detailed token breakdown in cli and app ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-10))
* fail-fast tool calls (skips approval on error) ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-22))
* file search in @ attachment menu ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-8))
* improved agent filesystem context ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-13))
* improved cli rendering ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-2))
* rewritten filesystem tools ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-19))
* shell_exec output streaming ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-21))
* thought, tool calls expandable in cli ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-11))
* token estimation, usage display ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-1))
* web search max results support ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-14))

### Bug Fixes

* message streaming doesn't grow scroll height in cli ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-23))
* some queries remain stale ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-3))
* stdio transport not working in cli ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-16))
* unused `id` arg in search_memories tool ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-20))
* various cleanup and fixes ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-4))

### Performance Improvements

* optimize tool call ui ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-5))
* reduce unnecessary settings queries ([49e7eec](https://github.com/RyanGarber/tiny-chat/commit/49e7eecda495ea72987d0fcd8dc11af3d2d5ca54-7))


## [0.7.7](https://github.com/RyanGarber/tiny-chat/compare/0.7.6...0.7.7) (2026-08-05)

### Features

* /reload command for providers, skills, and mcp servers ([14ad737](https://github.com/RyanGarber/tiny-chat/commit/14ad737517b3336491313f8bae36053424ede741-1))
* input tokens model arg ([14ad737](https://github.com/RyanGarber/tiny-chat/commit/14ad737517b3336491313f8bae36053424ede741))
* model arg defaults shown in cli input ([14ad737](https://github.com/RyanGarber/tiny-chat/commit/14ad737517b3336491313f8bae36053424ede741-2))

### Bug Fixes

* unable to manually trigger provider updates ([14ad737](https://github.com/RyanGarber/tiny-chat/commit/14ad737517b3336491313f8bae36053424ede741-3))


## [0.7.6](https://github.com/RyanGarber/tiny-chat/compare/0.7.5...0.7.6) (2026-08-05)

### Features

* allow dismissing updates in app ([3170b4b](https://github.com/RyanGarber/tiny-chat/commit/3170b4ba2251e4d65156f97a2fc0fccd2ef19e56-3))
* allow dismissing updates in app ([305049b](https://github.com/RyanGarber/tiny-chat/commit/305049b650a9d287b46e7312215dee62f7cc0359-2))
* auto code language detection ([3170b4b](https://github.com/RyanGarber/tiny-chat/commit/3170b4ba2251e4d65156f97a2fc0fccd2ef19e56-2))
* auto code language detection ([305049b](https://github.com/RyanGarber/tiny-chat/commit/305049b650a9d287b46e7312215dee62f7cc0359-1))
* context compaction ([3170b4b](https://github.com/RyanGarber/tiny-chat/commit/3170b4ba2251e4d65156f97a2fc0fccd2ef19e56))
* edit_file tool ([75de0f3](https://github.com/RyanGarber/tiny-chat/commit/75de0f310f29b6b8c98a1858e0d030c3c8002ad5))
* unified diffs ([3170b4b](https://github.com/RyanGarber/tiny-chat/commit/3170b4ba2251e4d65156f97a2fc0fccd2ef19e56-1))
* unified diffs ([305049b](https://github.com/RyanGarber/tiny-chat/commit/305049b650a9d287b46e7312215dee62f7cc0359))
* unified file tools ([367cbd5](https://github.com/RyanGarber/tiny-chat/commit/367cbd5afa3045f1a5d8ccef0197fdd4402bc4b3))

### Bug Fixes

* chats cached without id ([3170b4b](https://github.com/RyanGarber/tiny-chat/commit/3170b4ba2251e4d65156f97a2fc0fccd2ef19e56-4))
* chats cached without id ([305049b](https://github.com/RyanGarber/tiny-chat/commit/305049b650a9d287b46e7312215dee62f7cc0359-3))
* potential generation failure during actions ([367cbd5](https://github.com/RyanGarber/tiny-chat/commit/367cbd5afa3045f1a5d8ccef0197fdd4402bc4b3-1))
* tilde/homepath not resolved in cli ([bb5eb05](https://github.com/RyanGarber/tiny-chat/commit/bb5eb059f4c15c1799feb6a067bb8447f7920d88))
* various scrolling, fetching issues ([bb5eb05](https://github.com/RyanGarber/tiny-chat/commit/bb5eb059f4c15c1799feb6a067bb8447f7920d88-1))


## [0.7.5](https://github.com/RyanGarber/tiny-chat/compare/0.7.4...0.7.5) (2026-08-03)

### Features

* follow-ups during tool calls ([8c92e83](https://github.com/RyanGarber/tiny-chat/commit/8c92e838b587fee8d020c19df0ea19a52edc83f4))
* improved menus in cli ([8c92e83](https://github.com/RyanGarber/tiny-chat/commit/8c92e838b587fee8d020c19df0ea19a52edc83f4-1))

### Bug Fixes

* null chat id could prevent message creation ([6a0a46e](https://github.com/RyanGarber/tiny-chat/commit/6a0a46e281007e8d5c8813559cfcae16e770ccbd-2))
* tool result not transformed ([6a0a46e](https://github.com/RyanGarber/tiny-chat/commit/6a0a46e281007e8d5c8813559cfcae16e770ccbd-1))


## [0.7.4](https://github.com/RyanGarber/tiny-chat/compare/0.7.3...0.7.4) (2026-08-02)

### Bug Fixes

* use persistent storage in app ([99d31e6](https://github.com/RyanGarber/tiny-chat/commit/99d31e66c3f22f98ae2b9793d08c255d9db97667))


## [0.7.3](https://github.com/RyanGarber/tiny-chat/compare/0.7.2...0.7.3) (2026-08-02)

### Features

* autoscroll in cli ([ac6efbf](https://github.com/RyanGarber/tiny-chat/commit/ac6efbfe2456fc992230a295f32435f2b9caa182-1))
* chat list, message view in cli ([51aaba2](https://github.com/RyanGarber/tiny-chat/commit/51aaba26645fecb7c3bf57d2ed27f350a580112e))
* mcp tools, skills, and messaging in cli ([59c18ad](https://github.com/RyanGarber/tiny-chat/commit/59c18ad3daa1f255f312f5b8b26fc617af978c3c))
* unified cli and app commands, attachments, and tools ([ac6efbf](https://github.com/RyanGarber/tiny-chat/commit/ac6efbfe2456fc992230a295f32435f2b9caa182))


## [0.7.2](https://github.com/RyanGarber/tiny-chat/compare/0.7.1...0.7.2) (2026-07-30)

### Features

* cli prototype ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c))
* file citations ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-3))
* jina web provider ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-1))
* per-feature web providers choices ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-2))

### Bug Fixes

* ENOENTs in chat shell due to path mismatch ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-5))
* markdown not rendering inside citations ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-6))
* thoughts not round-tripped back to model ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-7))
* tool capabilities with custom names not working ([45b0a7d](https://github.com/RyanGarber/tiny-chat/commit/45b0a7dc0b843f55658357caa00de73a5fcb684c-4))


## [0.7.1](https://github.com/RyanGarber/tiny-chat/compare/0.7.0...0.7.1) (2026-07-28)

### Bug Fixes

* io error potentially prevents skills from loading ([26f4ad3](https://github.com/RyanGarber/tiny-chat/commit/26f4ad30796c4e92f6d67f521734e1143a9c1cbf-1))
* sign-in via magic link not completing ([26f4ad3](https://github.com/RyanGarber/tiny-chat/commit/26f4ad30796c4e92f6d67f521734e1143a9c1cbf-2))


## [0.7.0](https://github.com/RyanGarber/tiny-chat/compare/0.6.4...0.7.0) (2026-07-28)

### ⚠ BREAKING CHANGES

* redesigned tools, providers, and settings

### Features

* improved model performance ([ea48c77](https://github.com/RyanGarber/tiny-chat/commit/ea48c77a337b325bc27a0786d2dad5a67fc886c3-1))
* slash commands and attachments ([ea48c77](https://github.com/RyanGarber/tiny-chat/commit/ea48c77a337b325bc27a0786d2dad5a67fc886c3))
* tool prefixes for naming conflicts ([ea48c77](https://github.com/RyanGarber/tiny-chat/commit/ea48c77a337b325bc27a0786d2dad5a67fc886c3-4))

### Bug Fixes

* some models not recognizing tool schema ([ea48c77](https://github.com/RyanGarber/tiny-chat/commit/ea48c77a337b325bc27a0786d2dad5a67fc886c3-5))

### Code Refactoring

* redesigned tools, providers, and settings ([ea48c77](https://github.com/RyanGarber/tiny-chat/commit/ea48c77a337b325bc27a0786d2dad5a67fc886c3-3))


## [0.6.4](https://github.com/RyanGarber/tiny-chat/compare/0.6.3...0.6.4) (2026-07-10)

### Bug Fixes

* potential error when stringifying log data ([cae8ed0](https://github.com/RyanGarber/tiny-chat/commit/cae8ed0339e4ef3a8c15d4c2e1473a99e7e41f8f-1))
* rolldown code splitting causing silent runtime fail ([cae8ed0](https://github.com/RyanGarber/tiny-chat/commit/cae8ed0339e4ef3a8c15d4c2e1473a99e7e41f8f))


## [0.6.3](https://github.com/RyanGarber/tiny-chat/compare/0.6.2...0.6.3) (2026-07-10)

### Features

* automatic syntax highlighting in chat input ([fc03fb2](https://github.com/RyanGarber/tiny-chat/commit/fc03fb2532407c2e36567448660382bb3fe49f1a))
* best-effort decoding of files ([fc03fb2](https://github.com/RyanGarber/tiny-chat/commit/fc03fb2532407c2e36567448660382bb3fe49f1a-1))
* fuzzy matching of web references ([fc03fb2](https://github.com/RyanGarber/tiny-chat/commit/fc03fb2532407c2e36567448660382bb3fe49f1a-2))
* improved tables, refs, code blocks, and diffs ([f15eac6](https://github.com/RyanGarber/tiny-chat/commit/f15eac671542dfca05cfb3cc35353f010f62cc67))
* rich text editing ([610a607](https://github.com/RyanGarber/tiny-chat/commit/610a60752ab9379c31fe675d04d3669ac30b3fab))

### Bug Fixes

* bash commands returning wrong folder contents for basePath ([fc03fb2](https://github.com/RyanGarber/tiny-chat/commit/fc03fb2532407c2e36567448660382bb3fe49f1a-4))
* incorrect width when diff lines are collapsed ([f15eac6](https://github.com/RyanGarber/tiny-chat/commit/f15eac671542dfca05cfb3cc35353f010f62cc67-3))
* non-standard whitespace accepted in filenames ([fc03fb2](https://github.com/RyanGarber/tiny-chat/commit/fc03fb2532407c2e36567448660382bb3fe49f1a-3))
* selected code theme ignored by streamdown ([f15eac6](https://github.com/RyanGarber/tiny-chat/commit/f15eac671542dfca05cfb3cc35353f010f62cc67-4))

### Performance Improvements

* optimized component rendering ([f15eac6](https://github.com/RyanGarber/tiny-chat/commit/f15eac671542dfca05cfb3cc35353f010f62cc67-2))


## [0.6.2](https://github.com/RyanGarber/tiny-chat/compare/0.6.1...0.6.2) (2026-07-07)

### Bug Fixes

* selectable file preview not working for text uploads ([86118da](https://github.com/RyanGarber/tiny-chat/commit/86118daf4c59ab3f71ddb1f5462d151176ae11c1))


## [0.6.1](https://github.com/RyanGarber/tiny-chat/compare/0.6.0...0.6.1) (2026-07-06)

### Bug Fixes

* <message> tags not scrubbed from prompt ([fa46bc5](https://github.com/RyanGarber/tiny-chat/commit/fa46bc57dbc6232ef96e724ae55f4eefdaf2eaae-2))
* diff not rendering for local write_file calls ([fa46bc5](https://github.com/RyanGarber/tiny-chat/commit/fa46bc57dbc6232ef96e724ae55f4eefdaf2eaae-5))
* large text files not saving to db ([fa46bc5](https://github.com/RyanGarber/tiny-chat/commit/fa46bc57dbc6232ef96e724ae55f4eefdaf2eaae-4))
* mismatched file embedding and inclusion logic ([fa46bc5](https://github.com/RyanGarber/tiny-chat/commit/fa46bc57dbc6232ef96e724ae55f4eefdaf2eaae-1))
* repo clone fails due to bug in bun ([fa46bc5](https://github.com/RyanGarber/tiny-chat/commit/fa46bc57dbc6232ef96e724ae55f4eefdaf2eaae))
* some text wrongly scrubbed from prompt ([fa46bc5](https://github.com/RyanGarber/tiny-chat/commit/fa46bc57dbc6232ef96e724ae55f4eefdaf2eaae-3))
