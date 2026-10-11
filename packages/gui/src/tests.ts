import { MantineProvider } from "@mantine/core";
import { createElement, type ReactNode, act as reactAct } from "react";
import { render as _render } from "vitest-browser-react";
import { create, onAfterAll, onBeforeAll } from "#client/tests.ts";
import mantineTheme, { cssResolver } from "#gui/theme.tsx";

beforeAll(async () => {
	return await onBeforeAll({
		env: {
			VITE_SERVER_URL: String(import.meta.env.VITE_SERVER_URL),
			VITE_SERVER_PORT: String(import.meta.env.VITE_SERVER_PORT),
			VITE_WEB_URL: String(import.meta.env.VITE_WEB_URL),
			VITE_WEB_PORT: String(import.meta.env.VITE_WEB_PORT),
			DEV: String(import.meta.env.DEV),
			DEV_HOST: String(import.meta.env.DEV_HOST),
			DEV_ENV: String(import.meta.env.DEV_ENV),
		},
	});
});

export async function render(children: ReactNode) {
	const { root } = create(
		createElement(MantineProvider, {
			theme: mantineTheme,
			cssVariablesResolver: cssResolver,
			children,
		}),
	);
	return _render(root);
}

/**
 * React's `act`, flagged as an act environment only while it runs, as
 * vitest-browser-react's own `render` does. Leaving the flag on would warn
 * about every async update outside `act`; leaving it off warns inside it.
 */
export async function act(callback: () => Promise<void> | void) {
	const global = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
	global.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await reactAct(async () => {
			await callback();
		});
	} finally {
		global.IS_REACT_ACT_ENVIRONMENT = false;
	}
}

afterAll(async () => {
	return await onAfterAll();
});
