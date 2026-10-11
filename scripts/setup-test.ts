/// <reference types="../vitest.context.d.ts" />

import type { TestProject } from "vitest/node";
import { serverUrl, useServer } from "./use-server.ts";

export async function setup(project: TestProject) {
	const cleanup = await useServer();

	project.provide("serverUrl", serverUrl);

	return () => cleanup();
}
