import { createServer } from "node:http";
import { zServerEnv } from "#core/core/types/env.ts";
import { CommonUtils } from "#core/core/utils/CommonUtils.ts";
import { createLogger } from "#core/logger.ts";
import { ApiService } from "#server/core/services/ApiService.ts";
import { AuthService } from "#server/core/services/AuthService.ts";
import { ActionRunnerService } from "#server/features/agent/services/ActionRunnerService.ts";
import { DreamRunnerService } from "#server/features/agent/services/DreamRunnerService.ts";
import { EmbeddingRunnerService } from "#server/features/embedding/services/EmbeddingRunnerService.ts";
import { AntigravityService } from "#server/features/proxy/services/AntigravityService.ts";
import { McpService } from "#server/features/proxy/services/McpService.ts";
import { useEnv } from "../../../scripts/use-env.ts";
import { create, print } from "../../../scripts/use-stdout.ts";

useEnv({ type: zServerEnv });

if (import.meta.main) {
	createLogger({ logToDisk: true });

	const update = create("starting server");

	const server = createServer((req, res) => {
		res.setHeader(
			"Access-Control-Allow-Origin",
			req.headers.origin ?? (process.env.VITE_SERVER_URL as string),
		);
		res.setHeader("Access-Control-Allow-Credentials", "true");
		res.setHeader(
			"Access-Control-Allow-Methods",
			"GET, POST, PUT, DELETE, OPTIONS",
		);
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Transfer-Encoding, Authorization, X-Requested-With, Accept, tRPC-Accept, X-Antigravity-Account, X-Mcp-Url, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name",
		);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.url?.startsWith(CommonUtils.endpoints.api as string)) {
			ApiService.handle(req, res);
		} else if (req.url?.startsWith(CommonUtils.endpoints.auth as string)) {
			void AuthService.handle(req, res);
		} else if (req.url?.startsWith(CommonUtils.endpoints.mcp as string)) {
			void McpService.handle(req, res);
		} else if (req.url?.startsWith(CommonUtils.endpoints.antigravity)) {
			void AntigravityService.handle(req, res);
		} else {
			res.writeHead(200);
			res.end(`${req.method} ${req.url} OK`);
		}
	});

	server.listen(process.env.VITE_SERVER_PORT, () => {
		update(
			`server live at ${process.env.DEV_HOST}:${process.env.VITE_SERVER_PORT}`,
		);
		if (process.argv.some((arg) => /^['"]?--smoke['"]?$/.test(arg))) {
			print({
				message: "server was started in smoke mode. now stopping.",
				level: "warning",
			});
			process.exit(0);
			return;
		}
		const work = async () => {
			await ActionRunnerService.next();
			await DreamRunnerService.next();
			await EmbeddingRunnerService.next();
			setTimeout(() => void work(), 5 * 1000);
		};
		void work();
	});
}
