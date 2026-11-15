#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { task } from "@ryangarber/utils";
import { zClientEnv } from "#core/core/types/env.ts";
import { useEnv } from "../../../scripts/use-env.ts";

/**
 * The web: the app's build (`vite build`, as `cap sync` copies into the
 * native apps) as static files on `VITE_WEB_PORT`. The GUI routes by hash,
 * so every page is `index.html`.
 */
const env = useEnv({ type: zClientEnv });

const dist = fileURLToPath(new URL("../dist", import.meta.url));

const types: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
};

const status = await task("Starting web");

const server = createServer(async (req, res) => {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, { Allow: "GET, HEAD" }).end();
		return;
	}
	let pathname: string;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://_").pathname);
	} catch {
		res.writeHead(400).end();
		return;
	}
	const path = normalize(
		join(dist, pathname.endsWith("/") ? `${pathname}index.html` : pathname),
	);
	const file = path.startsWith(dist + sep)
		? await stat(path).catch(() => undefined)
		: undefined;
	if (!file?.isFile()) {
		res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
		return;
	}

	const modified = new Date(Math.floor(file.mtimeMs / 1000) * 1000);
	const since = Date.parse(req.headers["if-modified-since"] ?? "");
	res.setHeader("Last-Modified", modified.toUTCString());
	res.setHeader(
		"Cache-Control",
		// Vite hashes what it builds into `assets/`; the rest keeps its name.
		path.startsWith(join(dist, "assets") + sep)
			? "public, max-age=31536000, immutable"
			: "no-cache",
	);
	if (since >= modified.getTime()) {
		res.writeHead(304).end();
		return;
	}
	res.writeHead(200, {
		"Content-Type":
			types[extname(path).toLowerCase()] ?? "application/octet-stream",
		"Content-Length": file.size,
		"X-Content-Type-Options": "nosniff",
	});
	if (req.method === "HEAD") res.end();
	else
		createReadStream(path)
			.on("error", () => res.destroy())
			.pipe(res);
});

server.listen(Number.parseInt(env.VITE_WEB_PORT, 10), () => {
	void status.complete({ status: `Web live at port ${env.VITE_WEB_PORT}` });
});
