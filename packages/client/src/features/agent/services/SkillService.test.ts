import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillService } from "#client/features/agent/services/SkillService.ts";
import { HostShellService } from "#client/features/shell/services/HostShellService.ts";
import { NodeShellService } from "#client/features/shell/services/NodeShellService.ts";

let root: string;
let home: string;
let project: string;
let shell: ReturnType<typeof HostShellService.create>;

const writeSkill = async (path: string, name = "example") => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`---\nname: ${name}\ndescription: A fixture skill\n---\nInstructions.`,
	);
	return path;
};

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "tiny-chat-skills-"));
	home = join(root, "home");
	project = join(root, "project");
	await mkdir(project);
	const primitives = NodeShellService.create();
	const walk = primitives.walk;
	if (!walk) throw new Error("Node shell must support walking");
	shell = HostShellService.create({
		...primitives,
		cwd: async () => project,
		// Use real filesystem operations, with an isolated home directory.
		walk: (options) =>
			walk({
				...options,
				path: options.path.replace(/^~(?=\/|$)/, home),
			}),
	});
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("SkillService discovery", () => {
	it("loads all three user and primary-project roots, including ignored project skills", async () => {
		const paths: string[] = [];
		for (const base of [home, project]) {
			for (const directory of [".agents", ".codex", ".claude"]) {
				paths.push(
					await writeSkill(
						join(base, directory, "skills", "example", "SKILL.md"),
					),
				);
			}
		}
		await writeFile(join(project, ".gitignore"), ".*\n");
		const skills = await SkillService.discover({
			shell,
			primaryFolder: project,
		});
		expect(skills.map((skill) => skill.path)).toEqual(paths);
		expect(skills.every((skill) => skill.name === "example")).toBe(true);
	});

	it("finds multiple nested Codex system skills when other roots are missing", async () => {
		const paths = await Promise.all(
			["first", "second"].map((name) =>
				writeSkill(
					join(home, ".codex", "skills", ".system", name, "SKILL.md"),
					name,
				),
			),
		);
		const skills = await SkillService.discover({ shell });
		expect(skills.map((skill) => skill.path)).toEqual(paths);
		expect(skills.map((skill) => skill.name)).toEqual(["first", "second"]);
	});

	it("keeps project discovery scoped to the supplied primary folder", async () => {
		const first = await writeSkill(
			join(project, ".claude", "skills", "one", "SKILL.md"),
		);
		const other = join(root, "other");
		const second = await writeSkill(
			join(other, ".agents", "skills", "two", "SKILL.md"),
		);
		expect(
			(await SkillService.discover({ shell, primaryFolder: project })).map(
				(skill) => skill.path,
			),
		).toEqual([first]);
		expect(
			(await SkillService.discover({ shell, primaryFolder: other })).map(
				(skill) => skill.path,
			),
		).toEqual([second]);
	});

	it("deduplicates overlapping user and project roots by path", async () => {
		const path = await writeSkill(
			join(home, ".agents", "skills", "one", "SKILL.md"),
		);
		const skills = await SkillService.discover({ shell, primaryFolder: home });
		expect(skills.map((skill) => skill.path)).toEqual([path]);
	});
});
