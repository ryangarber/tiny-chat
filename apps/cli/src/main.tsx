import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "ink";
import { client } from "#cli/client.ts";
import { TokenService } from "#cli/core/services/TokenService.ts";
import { StderrUtils } from "#cli/core/utils/StderrUtils.ts";
import { ClientContext } from "#client/client.ts";
import Root from "#tui/core/components/Root.tsx";
import { StdinUtils } from "#tui/core/utils/StdinUtils.ts";
import type { AppOptions } from "./cli.ts";
import { StorageService } from "./core/services/StorageService.ts";

export async function main(options: AppOptions) {
	if (options.noKeyring) TokenService.keyring(false);

	const truecolor = StorageService.get<boolean>("truecolor");

	if (truecolor === true) process.env.FORCE_COLOR = "3";
	else if (truecolor === false) process.env.FORCE_COLOR = "2";

	const stdin = StdinUtils.filter(process.stdin);
	const restoreStderr = StderrUtils.capture();

	const instance = render(
		<QueryClientProvider client={client.queryClient}>
			<ClientContext value={client}>
				<Root />
			</ClientContext>
		</QueryClientProvider>,
		{
			exitOnCtrlC: false,
			// The logger is silent and keeps everything for `/console`; Ink's
			// patch would print above the UI, forcing a full redraw each time.
			patchConsole: false,
			stdin,
			// Legacy terminal input cannot say which modifiers a key was pressed
			// with: an arrow under Shift, under Alt, or under both can all arrive
			// as the same bytes, which is what leaves Alt and Shift selection to
			// the terminal's own key mapping. The kitty protocol reports them
			// apart, and the query behind `auto` is ignored by terminals that do
			// not speak it, so the ones that do need no setting turned on.
			kittyKeyboard: { mode: "auto" },
			incrementalRendering: true,
			alternateScreen: true,
			concurrent: true,
		},
	);

	// The UI quits by unmounting, which has run its cleanup by now. What
	// remains (queries, MCP servers, workers) is the process's to end.
	try {
		await instance.waitUntilExit();
	} finally {
		// Detach the adapter without closing the terminal owned by the process.
		stdin.destroy();
		restoreStderr();
	}
	process.exit(0);
}
