import { cli } from "#cli/cli.ts";

// not gated by `import.meta.main` because
// it's always false in windows bun binaries...
await cli();
