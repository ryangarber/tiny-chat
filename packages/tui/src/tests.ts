/// <reference types="../../../vitest.context.d.ts" />

import type { ReactNode } from "react";
import { afterAll, beforeAll } from "vitest";
import { create, onAfterAll, onBeforeAll } from "#client/tests.ts";
import { render as _render } from "#tui/core/utils/RenderTestUtils.tsx";
import { EditorInputService } from "#tui/features/editor/services/EditorInputService.ts";

beforeAll(async () => {
	return await onBeforeAll({
		env: {
			VITE_SERVER_URL: String(process.env.VITE_SERVER_URL),
			VITE_SERVER_PORT: String(process.env.VITE_SERVER_PORT),
			VITE_WEB_URL: String(process.env.VITE_WEB_URL),
			VITE_WEB_PORT: String(process.env.VITE_WEB_PORT),
			DEV: String(process.env.DEV),
			DEV_HOST: String(process.env.DEV_HOST ?? ""),
			DEV_ENV: String(process.env.DEV_ENV ?? ""),
		},
		input: EditorInputService,
	});
});

export default async function render(children: ReactNode) {
	const { root } = create(children);
	return _render(root);
}

afterAll(async () => {
	return await onAfterAll();
});
