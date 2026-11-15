export const apps = [
	{
		name: "web",
		script: "node",
		args: "./scripts/serve.ts",
		cwd: import.meta.dirname,
		exec_mode: "fork",
		instances: 1,
		autorestart: true,
		watch: false,
		max_memory_restart: "512M",
	},
];
