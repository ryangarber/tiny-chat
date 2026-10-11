import { expect } from "vitest";
import { CapabilityUtils } from "#core/core/utils/CapabilityUtils.ts";
import { mockUser } from "#core/tests.ts";

const getEnabled = (
	conditions: Partial<Parameters<typeof CapabilityUtils.getEnabled>[0]> = {},
) =>
	CapabilityUtils.getEnabled({
		user: mockUser(),
		providers: [],
		chat: true,
		message: true,
		incognito: false,
		temporary: false,
		desktop: false,
		...conditions,
	});

describe("CapabilityUtils", () => {
	it("gives every message a chat shell and GitHub", () => {
		const enabled = getEnabled({ chat: false, message: false });
		expect(enabled.chatShell).toBe(true);
		expect(enabled.github).toBe(true);
	});

	it("only offers the user's own machine to a desktop host", () => {
		expect(getEnabled({ desktop: false }).shell).toBe(false);
		expect(getEnabled({ desktop: true }).shell).toBe(true);
		expect(getEnabled({ desktop: false }).browser).toBe(false);
		expect(getEnabled({ desktop: true }).browser).toBe(true);
	});

	it("withholds what writes back to the user from incognito and temporary chats", () => {
		const incognito = getEnabled({ incognito: true });
		expect(incognito.persistence).toBe(false);
		expect(incognito.actions).toBe(false);
		expect(incognito.memories).toBe(false);
		expect(incognito.chatShell).toBe(true);

		const temporary = getEnabled({ temporary: true });
		expect(temporary.persistence).toBe(false);
		expect(temporary.actions).toBe(true);
		expect(temporary.memories).toBe(true);
		expect(temporary.chatShell).toBe(true);
	});

	it("needs a message to hang an action off", () => {
		expect(getEnabled({ message: false }).actions).toBe(false);
		expect(getEnabled({ message: true }).actions).toBe(true);
	});

	it("needs a configured provider for the web, embeddings and subagents", () => {
		const enabled = getEnabled();
		expect(enabled.web).toBe(false);
		expect(enabled.embedding).toBe(false);
		expect(enabled.subagents).toBe(false);
	});

	it("says what it cannot do without a saved row", () => {
		expect(CapabilityUtils.require({ id: "msg" }, "actions")).toEqual({
			id: "msg",
		});
		expect(() => CapabilityUtils.require(null, "actions")).toThrow(/actions/);
	});
});
