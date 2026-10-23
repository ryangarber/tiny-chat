/** biome-ignore-all lint/suspicious/noExplicitAny: the driver is untyped Node and page script */
/** biome-ignore-all lint/complexity/useArrowFunction: sent as source */
/** biome-ignore-all lint/performance/useDomNodeTextContent: reads rendered text */

/**
 * The browser driver: a small Node program that owns Playwright and answers
 * JSON-RPC over stdio, one message per line. It is started with `node -e`
 * through the runtime's stdio transport (the same one MCP servers use), so the
 * desktop app and the CLI drive a browser identically and neither bundles
 * Playwright — it is found on the user's machine.
 *
 * It travels as source (`driver.toString()`), so it must not close over
 * anything in this module, imports included. `require` and `process` come in as
 * arguments, out of reach of bundlers that rewrite those names. The functions
 * it hands to `page.evaluate` run in the page, not in Node.
 */
function driver(load: any, proc: any) {
	const fs = load("node:fs");
	const path = load("node:path");
	const os = load("node:os");
	const readline = load("node:readline");

	// stdout carries the protocol and nothing else; stderr is never drained by
	// the desktop app, so a chatty dependency would eventually block on it.
	const out = proc.stdout.write.bind(proc.stdout);
	const quiet = () => true;
	proc.stdout.write = quiet;
	proc.stderr.write = quiet;
	for (const level of ["log", "info", "warn", "error", "debug", "trace"]) {
		(console as any)[level] = () => {};
	}
	const send = (message: any) => out(`${JSON.stringify(message)}\n`);

	const home = os.homedir();
	const exists = (file: string) => {
		try {
			return fs.existsSync(file);
		} catch {
			return false;
		}
	};
	const list = (dir: string): string[] => {
		try {
			return fs.readdirSync(dir);
		} catch {
			return [];
		}
	};
	const readJson = (file: string) => {
		try {
			return JSON.parse(fs.readFileSync(file, "utf8"));
		} catch {
			return null;
		}
	};
	const compare = (a: string, b: string) => {
		const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
		const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
		}
		return 0;
	};
	const clean = (error: any) =>
		String(error?.message ?? error)
			.split("\nCall log:")[0]
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping escapes
			.replace(/\u001b\[[0-9;]*m/g, "")
			.trim()
			.slice(0, 1_000);

	// --- detection ----------------------------------------------------------

	/**
	 * Playwright as the user has it: the project's own copy first (walking up
	 * from the working directory, pnpm's store included), then global installs
	 * and npx's cache, newest first.
	 */
	const findPlaywright = (cwd: string) => {
		const local: string[] = [];
		for (let dir = cwd; ; dir = path.dirname(dir)) {
			const modules = path.join(dir, "node_modules");
			local.push(modules);
			for (const entry of list(path.join(modules, ".pnpm"))) {
				if (/^playwright(-core)?@/.test(entry)) {
					local.push(path.join(modules, ".pnpm", entry, "node_modules"));
				}
			}
			if (path.dirname(dir) === dir) break;
		}

		const prefix = path.dirname(path.dirname(proc.execPath));
		const global = [
			proc.platform === "win32"
				? path.join(path.dirname(proc.execPath), "node_modules")
				: path.join(prefix, "lib", "node_modules"),
			"/usr/local/lib/node_modules",
			"/opt/homebrew/lib/node_modules",
			path.join(home, ".npm-global", "lib", "node_modules"),
			path.join(home, ".bun", "install", "global", "node_modules"),
			...(proc.env.PNPM_HOME
				? [path.join(proc.env.PNPM_HOME, "global", "5", "node_modules")]
				: []),
			path.join(home, "Library", "pnpm", "global", "5", "node_modules"),
			path.join(home, ".local", "share", "pnpm", "global", "5", "node_modules"),
			...list(path.join(home, ".npm", "_npx")).map((entry) =>
				path.join(home, ".npm", "_npx", entry, "node_modules"),
			),
		];

		const find = (dirs: string[]) => {
			const found: { path: string; name: string; version: string }[] = [];
			for (const dir of dirs) {
				for (const name of ["playwright-core", "playwright"]) {
					const pkg = readJson(path.join(dir, name, "package.json"));
					if (pkg?.version) {
						found.push({
							path: fs.realpathSync(path.join(dir, name)),
							name,
							version: pkg.version,
						});
					}
				}
			}
			return found;
		};

		return (
			find(local)[0] ??
			find(global).sort((a, b) => compare(b.version, a.version))[0]
		);
	};

	const getAppVersion = (executable: string) => {
		const app = /^(.*?\.app)\/Contents\/MacOS\//.exec(executable)?.[1];
		if (!app) return undefined;
		try {
			const plist = fs.readFileSync(
				path.join(app, "Contents", "Info.plist"),
				"utf8",
			);
			return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)/.exec(
				plist,
			)?.[1];
		} catch {
			return undefined;
		}
	};

	/**
	 * Chromium-based browsers Playwright can launch: its own downloads, newest
	 * first, then the ones installed on the system.
	 */
	const findBrowsers = () => {
		const browsers: {
			name: string;
			path: string;
			source: "playwright" | "system";
			version?: string;
		}[] = [];

		const configured = proc.env.PLAYWRIGHT_BROWSERS_PATH;
		const cache =
			configured && configured !== "0"
				? configured
				: proc.platform === "darwin"
					? path.join(home, "Library", "Caches", "ms-playwright")
					: proc.platform === "win32"
						? path.join(
								proc.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
								"ms-playwright",
							)
						: path.join(
								proc.env.XDG_CACHE_HOME ?? path.join(home, ".cache"),
								"ms-playwright",
							);

		const revisions = list(cache)
			.map((entry) => /^chromium-(\d+)$/.exec(entry))
			.filter((match): match is RegExpExecArray => !!match)
			.sort((a, b) => Number(b[1]) - Number(a[1]));
		for (const [entry, revision] of revisions) {
			const root = path.join(cache, entry);
			if (!exists(path.join(root, "INSTALLATION_COMPLETE"))) continue;
			const executable = list(root)
				.filter((sub) => sub.startsWith("chrome-"))
				.flatMap((sub) => [
					path.join(
						root,
						sub,
						"Google Chrome for Testing.app",
						"Contents",
						"MacOS",
						"Google Chrome for Testing",
					),
					path.join(root, sub, "Chromium.app", "Contents", "MacOS", "Chromium"),
					path.join(root, sub, "chrome"),
					path.join(root, sub, "chrome.exe"),
				])
				.find(exists);
			if (executable) {
				browsers.push({
					name: `Chromium r${revision}`,
					path: executable,
					source: "playwright",
					version: getAppVersion(executable),
				});
			}
		}

		const system: [string, string][] = [];
		if (proc.platform === "darwin") {
			for (const app of [
				"Google Chrome",
				"Microsoft Edge",
				"Brave Browser",
				"Chromium",
				"Google Chrome Beta",
				"Google Chrome Canary",
			]) {
				for (const dir of ["/Applications", path.join(home, "Applications")]) {
					system.push([
						app,
						path.join(dir, `${app}.app`, "Contents", "MacOS", app),
					]);
				}
			}
		} else if (proc.platform === "win32") {
			const roots = [
				proc.env.PROGRAMFILES,
				proc.env["PROGRAMFILES(X86)"],
				proc.env.LOCALAPPDATA,
			].filter(Boolean);
			for (const root of roots) {
				system.push(
					[
						"Google Chrome",
						path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
					],
					[
						"Microsoft Edge",
						path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
					],
					[
						"Brave",
						path.join(
							root,
							"BraveSoftware",
							"Brave-Browser",
							"Application",
							"brave.exe",
						),
					],
				);
			}
		} else {
			const dirs = String(proc.env.PATH ?? "")
				.split(path.delimiter)
				.concat(["/usr/bin", "/usr/local/bin", "/snap/bin"]);
			for (const [name, bins] of [
				["Google Chrome", ["google-chrome", "google-chrome-stable"]],
				["Chromium", ["chromium", "chromium-browser"]],
				["Microsoft Edge", ["microsoft-edge", "microsoft-edge-stable"]],
				["Brave", ["brave-browser", "brave"]],
			] as const) {
				for (const bin of bins) {
					for (const dir of dirs) system.push([name, path.join(dir, bin)]);
				}
			}
		}
		const seen = new Set<string>();
		for (const [name, executable] of system) {
			if (seen.has(name) || !exists(executable)) continue;
			seen.add(name);
			browsers.push({
				name,
				path: executable,
				source: "system",
				version: getAppVersion(executable),
			});
		}

		return browsers;
	};

	const detect = ({ cwd }: { cwd?: string }) => {
		const playwright = findPlaywright(cwd || proc.cwd());
		const browsers = findBrowsers();
		const error = !playwright
			? "Playwright was not found. Install it globally (`npm install -g playwright`) or in your project."
			: !browsers.length
				? "No Chromium-based browser was found. Install Chrome, or run `npx playwright install chromium`."
				: undefined;
		return {
			available: !error,
			error,
			node: { path: proc.execPath, version: proc.version },
			playwright,
			browsers,
			browser: browsers[0],
		};
	};

	// --- page scripts (run in the browser) ---------------------------------

	/**
	 * The page as an indented outline of what a person would see and use:
	 * landmarks, headings, text, and controls with refs to act on. Wrappers
	 * that only lay things out are flattened away, and text inside a control
	 * becomes its name. Refs stay with their element until it leaves the DOM.
	 */
	const snapshot = function (root: any) {
		const w: any = globalThis;
		const document = w.document;
		w.__tinyChat ??= { els: new Map(), ids: new WeakMap(), next: 0 };
		const state = w.__tinyChat;
		for (const [ref, el] of state.els) {
			if (!el.isConnected) state.els.delete(ref);
		}
		const refOf = (el: any) => {
			let ref = state.ids.get(el);
			if (!ref) {
				ref = `e${++state.next}`;
				state.ids.set(el, ref);
			}
			state.els.set(ref, el);
			return ref;
		};

		const SKIP = new Set([
			"SCRIPT",
			"STYLE",
			"NOSCRIPT",
			"TEMPLATE",
			"HEAD",
			"META",
			"LINK",
		]);
		const INTERACTIVE = new Set([
			"link",
			"button",
			"checkbox",
			"radio",
			"switch",
			"slider",
			"textbox",
			"searchbox",
			"spinbutton",
			"combobox",
			"listbox",
			"option",
			"menuitem",
			"menuitemcheckbox",
			"menuitemradio",
			"tab",
			"treeitem",
		]);
		const FIELDS = new Set([
			"textbox",
			"searchbox",
			"spinbutton",
			"combobox",
			"listbox",
			"slider",
		]);
		const NAMED_BY_CONTENT = new Set([
			"link",
			"button",
			"heading",
			"tab",
			"menuitem",
			"menuitemcheckbox",
			"menuitemradio",
			"option",
			"treeitem",
			"checkbox",
			"radio",
			"switch",
			"cell",
			"columnheader",
		]);
		const INPUT_ROLES: Record<string, string> = {
			checkbox: "checkbox",
			radio: "radio",
			range: "slider",
			button: "button",
			submit: "button",
			reset: "button",
			image: "button",
			file: "button",
			search: "searchbox",
			number: "spinbutton",
			hidden: "",
		};
		const TAG_ROLES: Record<string, string> = {
			BUTTON: "button",
			SUMMARY: "button",
			TEXTAREA: "textbox",
			H1: "heading",
			H2: "heading",
			H3: "heading",
			H4: "heading",
			H5: "heading",
			H6: "heading",
			UL: "list",
			OL: "list",
			LI: "listitem",
			NAV: "navigation",
			MAIN: "main",
			HEADER: "banner",
			FOOTER: "contentinfo",
			ASIDE: "complementary",
			FORM: "form",
			DIALOG: "dialog",
			TABLE: "table",
			TR: "row",
			TH: "columnheader",
			TD: "cell",
			P: "paragraph",
			IFRAME: "iframe",
			VIDEO: "video",
			AUDIO: "audio",
			PRE: "code",
		};
		const getRole = (el: any) => {
			const explicit = el.getAttribute("role")?.split(/\s+/)[0];
			if (explicit) return explicit === "none" ? "presentation" : explicit;
			const tag = el.tagName;
			if (tag === "A") return el.hasAttribute("href") ? "link" : "";
			if (tag === "IMG") return el.getAttribute("alt") === "" ? "" : "img";
			if (tag === "SELECT")
				return el.multiple || el.size > 1 ? "listbox" : "combobox";
			if (tag === "INPUT") {
				const type = String(el.type || "text").toLowerCase();
				return INPUT_ROLES[type] ?? "textbox";
			}
			return TAG_ROLES[tag] ?? "";
		};
		const clip = (text: string, max: number) => {
			const value = String(text ?? "")
				.replace(/\s+/g, " ")
				.trim();
			return value.length > max ? `${value.slice(0, max - 1)}…` : value;
		};
		const getName = (el: any, role: string) => {
			const label = el.getAttribute("aria-label");
			if (label?.trim()) return clip(label, 100);
			const by = el.getAttribute("aria-labelledby");
			if (by) {
				const text = by
					.split(/\s+/)
					.map((id: string) => document.getElementById(id)?.innerText ?? "")
					.join(" ");
				if (text.trim()) return clip(text, 100);
			}
			if (el.labels?.length) {
				const text = [...el.labels]
					.map((label: any) => label.innerText)
					.join(" ");
				if (text.trim()) return clip(text, 100);
			}
			if (el.tagName === "IMG") return clip(el.alt ?? "", 100);
			if (el.tagName === "INPUT" && /^(submit|button|reset)$/.test(el.type)) {
				return clip(el.value, 100);
			}
			if (NAMED_BY_CONTENT.has(role)) {
				const text = clip(el.innerText ?? el.textContent ?? "", 100);
				if (text) return text;
			}
			return clip(
				el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "",
				100,
			);
		};
		const isVisible = (el: any, style: any) => {
			if (el.getAttribute("aria-hidden") === "true") return false;
			if (style.display === "contents") return true;
			if (style.visibility === "hidden" || style.visibility === "collapse")
				return false;
			if (el.checkVisibility) return el.checkVisibility();
			return style.display !== "none";
		};
		const getStyle = (el: any) => w.getComputedStyle(el);

		type Item =
			| { text: string }
			| { br: true }
			| {
					role: string;
					name: string;
					ref?: string;
					props: string[];
					children: Item[];
			  };

		const visit = (node: any): Item[] => {
			if (node.nodeType === 3) {
				return node.textContent.trim() ? [{ text: node.textContent }] : [];
			}
			if (node.nodeType !== 1 || SKIP.has(node.tagName)) return [];
			const el = node;
			const style = getStyle(el);
			if (!isVisible(el, style)) return [];

			let role = getRole(el);
			if (role === "presentation" || role === "generic") role = "";
			const pointer =
				style.cursor === "pointer" &&
				(!el.parentElement || getStyle(el.parentElement).cursor !== "pointer");
			const interactive =
				INTERACTIVE.has(role) ||
				(el.isContentEditable && !el.parentElement?.isContentEditable) ||
				el.hasAttribute("onclick") ||
				(el.hasAttribute("tabindex") && el.tabIndex >= 0) ||
				pointer;

			let children: Item[] = [];
			if (el.tagName === "SELECT") {
				children = [...el.options].slice(0, 25).map((option: any) => ({
					role: "option",
					name: clip(option.label, 80),
					props: option.selected ? ["selected"] : [],
					children: [],
				}));
			} else if (el.tagName !== "IFRAME") {
				const kids = el.shadowRoot
					? el.shadowRoot.childNodes
					: el.tagName === "SLOT" && el.assignedNodes().length
						? el.assignedNodes()
						: el.childNodes;
				for (const kid of kids) children.push(...visit(kid));
			}

			if (!role && !interactive) {
				// Layout only: its content joins the parent's, on its own line
				// unless it flows inline.
				const block = !String(style.display).startsWith("inline");
				return block ? [{ br: true }, ...children, { br: true }] : children;
			}

			const name = getName(el, role || "clickable");
			if (name && NAMED_BY_CONTENT.has(role)) {
				// the text is already the name
				children = children.filter((child) => !("text" in child));
			}

			const props: string[] = [];
			if (/^H[1-6]$/.test(el.tagName)) props.push(`level=${el.tagName[1]}`);
			if (role === "link" && el.getAttribute("href")) {
				const href = el.getAttribute("href");
				if (!href.startsWith("javascript:"))
					props.push(`href=${clip(href, 100)}`);
			}
			if (FIELDS.has(role) && el.tagName !== "SELECT" && "value" in el) {
				if (el.value) props.push(`value="${clip(el.value, 100)}"`);
				else if (el.placeholder && name !== el.placeholder)
					props.push(`placeholder="${clip(el.placeholder, 60)}"`);
			}
			if (el.type === "checkbox" || el.type === "radio") {
				if (el.checked) props.push("checked");
			} else if (el.getAttribute("aria-checked") === "true") {
				props.push("checked");
			}
			if (el.getAttribute("aria-expanded"))
				props.push(`expanded=${el.getAttribute("aria-expanded")}`);
			if (el.getAttribute("aria-selected") === "true") props.push("selected");
			if (el.disabled || el.getAttribute("aria-disabled") === "true")
				props.push("disabled");
			if (role === "iframe" && el.src) props.push(`src=${clip(el.src, 100)}`);

			return [
				{
					role: role || "clickable",
					name,
					ref: interactive ? refOf(el) : undefined,
					props,
					children,
				},
			];
		};

		const lines: string[] = [];
		const render = (items: Item[], depth: number) => {
			const pad = "  ".repeat(depth);
			let text = "";
			const flush = () => {
				const value = clip(text, 400);
				if (value) lines.push(`${pad}- text: ${value}`);
				text = "";
			};
			for (const item of items) {
				if ("text" in item) {
					text += item.text;
					continue;
				}
				flush();
				if ("br" in item) continue;
				let line = `${pad}- ${item.role}`;
				if (item.name) line += ` "${item.name.replace(/"/g, '\\"')}"`;
				for (const prop of item.props) line += ` [${prop}]`;
				if (item.ref) line += ` [ref=${item.ref}]`;
				const content = item.children.filter((child) => !("br" in child));
				if (content.length && content.every((child) => "text" in child)) {
					const value = clip(
						content.map((child) => (child as { text: string }).text).join(""),
						400,
					);
					lines.push(value ? `${line}: ${value}` : line);
				} else if (content.length) {
					lines.push(`${line}:`);
					render(item.children, depth + 1);
				} else {
					lines.push(line);
				}
			}
			flush();
		};

		render(visit(root ?? document.body ?? document.documentElement), 0);
		return lines.join("\n");
	};

	const getHtml = function (root: any) {
		const w: any = globalThis;
		const clone = (root ?? w.document.documentElement).cloneNode(true);
		for (const node of clone.querySelectorAll(
			"script, style, noscript, template, link[rel=stylesheet]",
		)) {
			node.remove();
		}
		return clone.outerHTML;
	};

	const getText = function (root: any) {
		const w: any = globalThis;
		return (root ?? w.document.body ?? w.document.documentElement).innerText;
	};

	// --- session -------------------------------------------------------------

	type Log = { level: string; text: string };
	type Options = {
		playwright: string;
		executablePath: string;
		headless: boolean;
		userDataDir?: string;
	};

	let session: { key: string; context: any; browser?: any } | null = null;
	let active: any = null;
	const logs = new WeakMap<any, Log[]>();
	const aborted = new Set<any>();

	const track = (page: any) => {
		const entries: Log[] = [];
		logs.set(page, entries);
		const push = (entry: Log) => {
			entries.push({ level: entry.level, text: entry.text.slice(0, 2_000) });
			if (entries.length > 500) entries.shift();
		};
		page.on("console", (message: any) =>
			push({ level: message.type(), text: message.text() }),
		);
		page.on("pageerror", (error: any) =>
			push({ level: "error", text: String(error?.stack ?? error) }),
		);
		// A dialog left open blocks the page, so they are accepted and logged.
		page.on("dialog", (dialog: any) => {
			push({
				level: "info",
				text: `[${dialog.type()} dialog accepted] ${dialog.message()}`,
			});
			dialog.accept().catch(() => {});
		});
	};

	const close = async () => {
		const current = session;
		session = null;
		active = null;
		await current?.context.close().catch(() => {});
		await current?.browser?.close().catch(() => {});
	};

	const ensure = async (options: Options) => {
		const key = JSON.stringify([
			options.playwright,
			options.executablePath,
			options.headless,
		]);
		if (session?.key === key) return session;
		await close();

		const { chromium } = load(options.playwright);
		const launch = {
			executablePath: options.executablePath,
			headless: options.headless,
			args: ["--no-first-run", "--no-default-browser-check"],
		};
		const contextOptions = {
			viewport: options.headless ? { width: 1280, height: 800 } : null,
		};

		// its own profile, so sign-ins made in it last between sessions
		const userDataDir =
			options.userDataDir ?? path.join(home, ".tiny-chat", "browser");

		let context: any;
		let browser: any;
		try {
			fs.mkdirSync(userDataDir, { recursive: true });
			context = await chromium.launchPersistentContext(userDataDir, {
				...launch,
				...contextOptions,
			});
		} catch (error) {
			// The profile is held by another window (the CLI and the desktop app
			// at once): fall back to a fresh, throwaway one.
			if (!/ProcessSingleton|already in use|SingletonLock/i.test(clean(error)))
				throw error;
			browser = await chromium.launch(launch);
			context = await browser.newContext(contextOptions);
		}

		context.setDefaultTimeout(10_000);
		context.setDefaultNavigationTimeout(30_000);
		const current = { key, context, browser };
		session = current;
		context.on("close", () => {
			if (session === current) {
				session = null;
				active = null;
			}
		});
		context.on("page", (page: any) => {
			track(page);
			active = page;
		});
		for (const page of context.pages()) track(page);
		active = context.pages().at(-1) ?? (await context.newPage());
		return current;
	};

	const getPage = async () => {
		if (!session) throw new Error("The browser is not running");
		if (!active || active.isClosed()) {
			active =
				session.context.pages().at(-1) ?? (await session.context.newPage());
		}
		return active;
	};

	// --- steps ---------------------------------------------------------------

	const resolve = async (page: any, step: any) => {
		if (step.ref) {
			const handle = await page.evaluateHandle(
				(ref: string) => (globalThis as any).__tinyChat?.els.get(ref) ?? null,
				step.ref,
			);
			const element = handle.asElement();
			if (!element) {
				throw new Error(
					`No element ${step.ref} on this page; read the page again for fresh refs`,
				);
			}
			return element;
		}
		if (step.selector) return page.locator(step.selector).first();
		return null;
	};

	const getPoint = async (step: any, target: any) => {
		if (target) {
			await target.scrollIntoViewIfNeeded();
			const box = await target.boundingBox();
			if (!box) throw new Error("The element has no box to point at");
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		}
		if (typeof step.x === "number" && typeof step.y === "number") {
			return { x: step.x, y: step.y };
		}
		return null;
	};

	const truncate = (text: string, max: number) =>
		text.length > max
			? `${text.slice(0, max)}\n… ${text.length - max} more characters; read a narrower ref or selector, or raise maxLength`
			: text;

	const compile = (script: string) => {
		const source = script.trim();
		const candidates =
			/^(async\s+)?(function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/.test(source)
				? [source]
				: [`async (el) => (${source}\n)`, `async (el) => {\n${source}\n}`];
		let failure: unknown;
		for (const candidate of candidates) {
			try {
				return new Function(`return (${candidate}\n)`)();
			} catch (error) {
				failure = error;
			}
		}
		throw failure;
	};

	const shoot = async (page: any, target: any, fullPage?: boolean) => {
		const options = { type: "jpeg", quality: 70, scale: "css" };
		const buffer = target
			? await target.screenshot(options)
			: await page.screenshot({ ...options, fullPage: !!fullPage });
		return { mime: "image/jpeg", data: buffer.toString("base64") };
	};

	const steps: Record<string, (_: any) => Promise<unknown>> = {
		navigate: async ({ page, step }) => {
			const options = { waitUntil: "domcontentloaded" };
			let response: any;
			if (step.url === "back") response = await page.goBack(options);
			else if (step.url === "forward") response = await page.goForward(options);
			else if (step.url === "reload") response = await page.reload(options);
			else {
				const url = /^[a-z][a-z\d+.-]*:/i.test(step.url)
					? step.url
					: `${/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(step.url) ? "http" : "https"}://${step.url}`;
				response = await page.goto(url, options);
			}
			return response ? { status: response.status() } : undefined;
		},

		read: async ({ page, step }) => {
			const target = await resolve(page, step);
			const format = step.format ?? "tree";
			const fn =
				format === "text" ? getText : format === "html" ? getHtml : snapshot;
			const text: string = target
				? await target.evaluate(fn)
				: await page.evaluate(fn, null);
			return truncate(text ?? "", step.maxLength ?? 20_000);
		},

		click: async ({ page, step }) => {
			const target = await resolve(page, step);
			const options = {
				button: step.button,
				clickCount: step.count,
				modifiers: step.modifiers,
			};
			if (target) return void (await target.click(options));
			const point = await getPoint(step, null);
			if (!point) throw new Error("click needs a ref, selector, or x and y");
			for (const key of step.modifiers ?? []) await page.keyboard.down(key);
			try {
				await page.mouse.click(point.x, point.y, options);
			} finally {
				for (const key of step.modifiers ?? []) await page.keyboard.up(key);
			}
		},

		hover: async ({ page, step }) => {
			const target = await resolve(page, step);
			if (target) return void (await target.hover());
			const point = await getPoint(step, null);
			if (!point) throw new Error("hover needs a ref, selector, or x and y");
			await page.mouse.move(point.x, point.y);
		},

		type: async ({ page, step }) => {
			const target = await resolve(page, step);
			if (target) {
				const options: string[] | null = await target.evaluate((el: any) =>
					el.tagName === "SELECT"
						? [...el.options].map((o: any) => `${o.value}\n${o.label}`)
						: null,
				);
				if (options) {
					const match = options
						.map((option) => option.split("\n"))
						.find(
							([value, label]) => value === step.text || label === step.text,
						);
					if (!match) {
						throw new Error(
							`No option "${step.text}"; options are: ${options.map((o) => o.split("\n")[1]).join(", ")}`,
						);
					}
					await target.selectOption(match[0]);
				} else if (step.clear !== false) {
					await target.fill(step.text);
				} else {
					await target.focus();
					await page.keyboard.type(step.text);
				}
			} else {
				await page.keyboard.type(step.text);
			}
			if (step.submit) await page.keyboard.press("Enter");
		},

		press: async ({ page, step }) => {
			for (const key of String(step.keys).split(/\s+/).filter(Boolean)) {
				await page.keyboard.press(key);
			}
		},

		scroll: async ({ page, step }) => {
			const target = await resolve(page, step);
			if (target && step.dx === undefined && step.dy === undefined) {
				await target.scrollIntoViewIfNeeded();
			} else {
				const viewport =
					page.viewportSize() ??
					(await page.evaluate(() => ({
						width: (globalThis as any).innerWidth,
						height: (globalThis as any).innerHeight,
					})));
				const point = (await getPoint(step, target)) ?? {
					x: viewport.width / 2,
					y: viewport.height / 2,
				};
				await page.mouse.move(point.x, point.y);
				await page.mouse.wheel(step.dx ?? 0, step.dy ?? 600);
				await page.waitForTimeout(150);
			}
			return await page.evaluate(() => ({
				scrollX: Math.round((globalThis as any).scrollX),
				scrollY: Math.round((globalThis as any).scrollY),
			}));
		},

		wait: async ({ page, step }) => {
			const timeout = step.timeout ?? 10_000;
			const state = step.state ?? "visible";
			if (typeof step.ms === "number") {
				await page.waitForTimeout(Math.min(step.ms, 30_000));
			} else if (step.ref) {
				const target = await resolve(page, step);
				if (state === "visible" || state === "hidden") {
					await target.waitForElementState(state, { timeout });
				} else if (state === "detached") {
					await page.waitForFunction((el: any) => !el.isConnected, target, {
						timeout,
					});
				}
			} else if (step.selector) {
				await page.locator(step.selector).first().waitFor({ state, timeout });
			} else if (step.text) {
				await page.getByText(step.text).first().waitFor({ state, timeout });
			} else if (step.url) {
				await page.waitForURL(step.url, { timeout });
			} else if (step.script) {
				await page.waitForFunction(step.script, null, { timeout });
			} else if (step.load) {
				await page.waitForLoadState(step.load, { timeout });
			} else {
				throw new Error(
					"wait needs one of ms, ref, selector, text, url, script or load",
				);
			}
		},

		evaluate: async ({ page, step }) => {
			const target = await resolve(page, step);
			const fn = compile(step.script);
			const value = target
				? await target.evaluate(fn)
				: await page.evaluate(fn, null);
			const json = JSON.stringify(value ?? null) ?? "null";
			return json.length > 20_000 ? truncate(json, 20_000) : (value ?? null);
		},

		console: async ({ page, step }) => {
			const entries = logs.get(page) ?? [];
			const levels =
				step.level === "error"
					? ["error"]
					: step.level === "warning"
						? ["error", "warning"]
						: null;
			const selected = entries
				.filter((entry) => !levels || levels.includes(entry.level))
				.slice(-(step.limit ?? 50))
				.map((entry) => `[${entry.level}] ${entry.text}`);
			if (step.clear) entries.length = 0;
			return selected;
		},

		screenshot: async ({ page, step, screenshots }) => {
			const target = await resolve(page, step);
			screenshots.push(await shoot(page, target, step.fullPage));
			return `screenshot ${screenshots.length} attached`;
		},

		tabs: async ({ step }) => {
			if (!session) throw new Error("The browser is not running");
			const context = session.context;
			const pick = (index: number) => {
				const page = context.pages()[index];
				if (!page) throw new Error(`No tab at index ${index}`);
				return page;
			};
			if (typeof step.close === "number") await pick(step.close).close();
			if (typeof step.open === "string") {
				const page = await context.newPage();
				active = page;
				await steps.navigate({ page, step: { url: step.open } });
			}
			if (typeof step.select === "number") {
				active = pick(step.select);
				await active.bringToFront();
			}
			const page = await getPage();
			return await Promise.all(
				context.pages().map(async (other: any, index: number) => ({
					index,
					url: other.url(),
					title: await other.title().catch(() => ""),
					active: other === page,
				})),
			);
		},
	};

	const run = async (params: any, id: unknown) => {
		await ensure(params);
		const results: any[] = [];
		const screenshots: { mime: string; data: string }[] = [];
		let skipped = 0;

		for (const [index, step] of params.steps.entries()) {
			if (aborted.has(id)) {
				skipped = params.steps.length - index;
				break;
			}
			const page = await getPage();
			try {
				const handler = steps[step.action];
				if (!handler) throw new Error(`Unknown action ${step.action}`);
				const value = await handler({ page, step, screenshots });
				results.push(
					value === undefined
						? { action: step.action, ok: true }
						: { action: step.action, ok: true, value },
				);
			} catch (error) {
				results.push({ action: step.action, ok: false, error: clean(error) });
				skipped = params.steps.length - index - 1;
				break;
			}
		}
		aborted.delete(id);

		const page = await getPage();
		if (params.screenshot) {
			try {
				screenshots.push(await shoot(page, null));
			} catch {}
		}
		return {
			url: page.url(),
			title: await page.title().catch(() => ""),
			steps: results,
			...(skipped ? { skipped } : {}),
			screenshots,
		};
	};

	// --- protocol ------------------------------------------------------------

	const methods: Record<string, (params: any, id: unknown) => Promise<any>> = {
		detect: async (params) => detect(params),
		run,
		close: async () => {
			await close();
			return {};
		},
	};

	// Runs share one page, so they go one at a time.
	let queue: Promise<unknown> = Promise.resolve();

	const shutdown = async () => {
		await close();
		proc.exit(0);
	};

	readline
		.createInterface({ input: proc.stdin })
		.on("line", (line: string) => {
			let message: any;
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.method === "abort") {
				aborted.add(message.params?.id);
				return;
			}
			if (message.id === undefined) return;
			const method = methods[message.method];
			const task = async () => {
				try {
					if (!method) throw new Error(`Unknown method ${message.method}`);
					send({
						jsonrpc: "2.0",
						id: message.id,
						result: await method(message.params ?? {}, message.id),
					});
				} catch (error) {
					send({
						jsonrpc: "2.0",
						id: message.id,
						error: { code: -32000, message: clean(error) },
					});
				}
			};
			if (message.method === "detect") void task();
			else queue = queue.then(task);
		})
		// the app or CLI went away
		.on("close", () => void shutdown());
	proc.on("SIGTERM", () => void shutdown());
}

export const BrowserDriverUtils = {
	/** The program for `node -e`. */
	script: `(${driver.toString()})(require, process);`,
} as const;
