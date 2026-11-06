import { resolve } from "node:path";
import FastifyStatic from "@fastify/static";
import { task } from "@ryangarber/utils";
import { config } from "dotenv";
import Fastify from "fastify";

config({ path: "../../.env", quiet: true });

const fastify = Fastify();

fastify.register(FastifyStatic, {
	root: resolve(import.meta.dirname, "../dist"),
});

const status = await task("Starting web");

export const server = {
	fastify,

	start: () => {
		fastify.listen(
			{ port: parseInt(process.env.VITE_WEB_PORT as string, 10) },
			(err, address) => {
				if (err) {
					fastify.log.error(err);
					process.exit(1);
				}
				status.complete({ status: `Web live at: ${address}` });
			},
		);
	},
};
