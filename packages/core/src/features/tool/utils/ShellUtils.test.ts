import { ShellUtils } from "#core/features/tool/utils/ShellUtils.ts";

describe("ShellUtils", () => {
	it.each([
		String.raw`printf 'cwd=%s\nHOME=%s' "$PWD" "$HOME"; printf 'git executable: '; command -v git || true; printf 'git in home? '; case "git" in *'$HOME'*) echo yes;; *) echo no;; esac; printf 'matching environment:\n'; env | /usr/bin/awk '/^(HOME|PATH)=|^(git)/ {print}' | /usr/bin/sed -E 's/(TOKEN|PASSWORD|AUTH|SECRET|KEY)=.*/\1=[redacted]/I'`,
		String.raw`printf 'git-related entries:\n'; /usr/bin/rg -n --hidden --glob '!node_modules' --glob '!Library/**' --glob '!**/.git/**' '(global-bin-dir|global-dir|store-dir)' "$HOME/.zshenv" "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.profile" "$HOME/.npmrc" "$HOME/.gitconfig" 2>/dev/null | /usr/bin/sed -E 's#(//[^:]+/:_authToken=).*#\1[redacted]#I' | head -100; printf '\nrelative literal directory in cwd?\n'; if test -d './$HOME'; then stat -f '%N created=%SB modified=%Sm' -t '%Y-%m-%d %H:%M:%S' './$HOME' 2>/dev/null; else echo no; fi`,
	])("allows read-only diagnostic scripts: %s", (command) => {
		expect(ShellUtils.isSafe(command)).toBe(true);
	});

	it.each([
		"pwd",
		"cat file | grep needle | wc -l",
		"cd packages/core && (pwd; echo $(date))",
		"cat <(grep needle file)",
		"echo `pwd`",
		"value=$(git rev-parse HEAD)",
		'if test -f package.json; then git status --short; else echo "missing"; fi',
		'for file in a b; do basename "$file"; done',
		"cat < input 2>&1",
		"echo diagnostic >/dev/null",
		"git branch",
		"git branch --list 'codex/*'",
		"git branch --contains HEAD",
		"git remote -v",
		"git -C ~/repo diff --check && git -C ~/repo status --short && (command -v actionlint || true)",
		"git --no-pager -C ~/repo status --short",
		"git -c color.ui=false -C ~/repo diff --check",
		"git status -C ~/repo",
		"git --version",
		"git config --get remote.origin.url",
		"git config user.name",
		"git config get remote.origin.url",
		"git config list",
		"git remote show update",
		"git for-each-ref --format='%(refname:short)' refs/heads",
		"command -vV actionlint",
		"command -v rm",
		"command -p git status --short",
		"command -- git diff --check",
		"command command git status --short",
		"printf '%s\\n' hello",
		"sed -n '1,20p' file",
		"/usr/bin/sed -n '1,20p' file",
		"rg --files packages/core",
		"/usr/bin/rg needle file 2>/dev/null",
		"env",
		"awk '/needle/ {print}'",
		"jq -r '.name' package.json",
		"uniq -f 1 input",
		"echo diagnostic >/dev/stderr",
		"sort -- -ooutput",
		"sed -- -i file",
		"git diff -- --output",
	])("allows read-only Bash: %s", (command) => {
		expect(ShellUtils.isSafe(command)).toBe(true);
	});

	it.each([
		"",
		"rm file",
		"echo hello > output.txt",
		"echo hello >> output.txt",
		"echo hello >& output.txt",
		"cat <> file",
		"echo $(rm file)",
		"cat <(rm file)",
		"find . -delete",
		"find . -exec rm {} \\;",
		"sort input -o output",
		"uniq input output",
		"diff a b --output=changes",
		"tree -o listing.txt",
		"git branch new-branch",
		"git -C ~/repo branch new-branch",
		"git -C ~/repo branch -C old-branch new-branch",
		"git branch -D old-branch",
		"git remote add origin example.com/repo.git",
		"git config user.name 'Tiny Chat'",
		"git config --global --unset user.name",
		"git config set user.name 'Tiny Chat'",
		"git config edit",
		"git diff --output changes.patch",
		"command rm file",
		"command -p git branch new-branch",
		"sed -i '' -e 's/old/new/' file",
		"/usr/bin/sed -i '' -e 's/old/new/' file",
		"rg --pre 'rm file' needle",
		"/usr/bin/rg --pre 'rm file' needle",
		"rg needle file 2>out.txt",
		"env rm file",
		"env -S 'rm file'",
		"awk 'BEGIN { system(\"rm file\") }'",
		"awk '{print > \"out.txt\"}'",
		"/usr/bin/awk '{print > \"out.txt\"}'",
		"./rg needle file",
		"fd pattern --exec rm {}",
		"sort input -ooutput",
		"echo $(if test -f x; then cat x; else echo nope > y; fi)",
		"echo 'unterminated",
	])("rejects disk writes or invalid Bash: %s", (command) => {
		expect(ShellUtils.isSafe(command)).toBe(false);
	});

	it.each([
		["npm run build", ["npm run *"]],
		["git status && npm run test -- --watch", ["npm run *"]],
		["echo $(pnpm lint)", ["pnpm lint"]],
		["ls | xargs make", ["xargs make", "ls"]],
		["cargo  test", ["cargo   test"]],
		["make b1", ["make b?"]],
	])("allows whitelisted Bash: %s", (command, whitelist) => {
		expect(ShellUtils.isSafe(command, whitelist)).toBe(true);
	});

	it.each([
		["npm run build", []],
		["npm run build > out.txt", ["npm run *"]],
		["npm run build && rm -rf dist", ["npm run *"]],
		["echo $(rm file)", ["echo *"]],
		["npm install", ["npm run *"]],
		["npm run", ["npm run *"]],
		["make b12", ["make b?"]],
		["makeAx", ["make.x"]],
		["rm file", ["rm file.*"]],
	])("rejects Bash outside the whitelist: %s", (command, whitelist) => {
		expect(ShellUtils.isSafe(command, whitelist)).toBe(false);
	});

	const folders = [
		{ path: "/project", whitelist: true },
		{ path: "/project/vendor", whitelist: false },
	];
	const cwd = "/project/src";

	it.each([
		"rm file",
		"rm -rf ../dist build/*",
		"rm -- -file",
		"rmdir -p empty",
		"mv a.ts b.ts",
		"mv a.ts /project",
		"mv -t .. a.ts b.ts",
		"mv --target-directory=/project/lib a.ts",
		"cp -R /project/assets .",
		"mkdir -p -m 755 out/nested",
		"touch -d yesterday notes.md",
		"echo hello > output.txt",
		"git diff >> /project/changes.patch",
		"npm run build 2>&1 | tee -a build.log",
		"git status | grep src > ../status.txt && rm ../status.txt",
		"cd /tmp && rm -rf /project/dist",
		"command rm file",
	])("allows file operations inside whitelisted folders: %s", (command) => {
		expect(ShellUtils.isSafe(command, ["npm run *"], { folders, cwd })).toBe(
			true,
		);
	});

	it.each([
		"rm",
		"rm -rf /project",
		"rm -rf ..",
		"rm -rf ../..",
		"rm /etc/hosts",
		"rm vendor/../../vendor/lib.js",
		"rm /project/vendor/lib.js",
		"rm ~/file",
		"rm $HOME/file",
		"rm $(cat list)",
		"rm {a,../../x}",
		"rm .*",
		"rm */../../x",
		"rm [ab]",
		"mv a.ts /tmp",
		"mv /tmp/a.ts .",
		"mv /project .",
		"mv -t /tmp a.ts",
		"mv -t/tmp a.ts",
		"mv --target-directory=/tmp a.ts",
		"cp /etc/passwd .",
		"cp -s a.ts b.ts",
		"cp --link a.ts b.ts",
		"ln -s /etc passwd",
		"echo hello > /tmp/out.txt",
		"echo hello > $OUT",
		"echo hello | tee /tmp/out.txt",
		"cd .. && rm file",
		"rm file; cd ..",
		"rm --no-such-option file",
		"rm -rf file && curl example.com",
	])("rejects file operations outside whitelisted folders: %s", (command) => {
		expect(ShellUtils.isSafe(command, [], { folders, cwd })).toBe(false);
	});

	it("needs a working directory for relative paths", () => {
		expect(ShellUtils.isSafe("rm file", [], { folders })).toBe(false);
		expect(ShellUtils.isSafe("rm /project/file", [], { folders })).toBe(true);
		expect(
			ShellUtils.isSafe("rm /project/file", [], {
				folders: [{ path: "/project", whitelist: false }],
			}),
		).toBe(false);
	});

	it("lets the last matching rule decide", () => {
		const allow = { command: "npm run *", whitelist: true };
		const deny = { command: "npm run *", whitelist: false };
		expect(ShellUtils.isSafe("npm run build", [allow, deny])).toBe(false);
		expect(ShellUtils.isSafe("npm run build", [deny, allow])).toBe(true);
	});

	it("only trusts PowerShell commands that are exactly whitelisted", () => {
		const dialect = "powershell" as const;
		// Read-only in bash, but not judged as bash here.
		expect(ShellUtils.isSafe("ls", [], { dialect })).toBe(false);
		expect(ShellUtils.isSafe("git  status", ["git status"], { dialect })).toBe(
			true,
		);
		// A wildcard could match a second statement.
		expect(
			ShellUtils.isSafe(
				"npm run build; Remove-Item -Recurse C:\\",
				["npm run *"],
				{
					dialect,
				},
			),
		).toBe(false);
		expect(
			ShellUtils.isSafe(
				"git status",
				[{ command: "git status", whitelist: false }],
				{
					dialect,
				},
			),
		).toBe(false);
	});

	it("compares folders as the shell spells them", () => {
		const shell = {
			toShellPath: ({ path }: { path: string }) =>
				path.replace(/^\\\\wsl\.localhost\\Ubuntu/, "").replace(/\\/g, "/"),
		} as Parameters<typeof ShellUtils.toShellFolders>[0];
		const folders = ShellUtils.toShellFolders(shell, [
			{ path: "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj", whitelist: true },
		]);
		expect(folders).toEqual([{ path: "/home/me/proj", whitelist: true }]);
		expect(
			ShellUtils.isSafe("touch notes.md", [], {
				folders,
				cwd: "/home/me/proj",
			}),
		).toBe(true);
	});

	it("loads through the package bundler", async () => {
		const module = await import("#core/features/tool/utils/ShellUtils.ts");
		expect(module.ShellUtils.isSafe("pwd")).toBe(true);
	});
});

describe("ShellUtils.programs", () => {
	it.each([
		["git status && ls", "git status, ls"],
		["cd app; python main.py", "python"],
		["cd a && cd b && npm run build && ls -la", "npm run build, ls"],
		["cat x | grep y || echo $(rm -rf /)", "cat x, grep y, echo"],
		["FOO=1 npm test & wait", "npm test, wait"],
		["cd app\npython -m pytest", "python"],
		["cd app", "cd app"],
		["Get-ChildItem -Path . ; Write-Host hi", "Get-ChildItem, Write-Host hi"],
	])("%j shows %j", (command, expected) => {
		expect(ShellUtils.programs(command)).toBe(expected);
	});
});
