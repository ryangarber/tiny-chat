import "#gui/main.css";
import "streamdown/styles.css";

import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { ClientContext } from "#client/client.ts";
import ErrorBoundary from "#client/core/components/ErrorBoundary.tsx";
import { useConsoleStore } from "#client/core/stores/useConsoleStore.ts";
import { createLogger } from "#core/logger.ts";
import { client } from "#gui/client.ts";
import { runtime } from "#gui/client-runtime.ts";
import App from "#gui/core/components/App.tsx";
import { RuntimeContext } from "#gui/core/hooks/useRuntime.ts";

createLogger({ logWriter: useConsoleStore.getState().writer });

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root, {
	// Every boundary in the app logs what it caught, with what failed to draw;
	// React's own report would only repeat it. Others are left to React.
	onCaughtError: (error, info) => {
		if (info.errorBoundary instanceof ErrorBoundary) return;
		console.error("[main] caught", error, info.componentStack);
	},
}).render(
	<React.StrictMode>
		{/* Below the app's own, for a failure in the app itself or its theme. */}
		<ErrorBoundary
			label="the app"
			fallback={({ error }) => (
				<div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
					<h3>Something went wrong</h3>
					<pre style={{ whiteSpace: "pre-wrap" }}>{error.message}</pre>
					<button type="button" onClick={() => window.location.reload()}>
						Reload
					</button>
				</div>
			)}
		>
			<QueryClientProvider client={client.queryClient}>
				<ClientContext value={client}>
					<RuntimeContext value={runtime}>
						<App />
					</RuntimeContext>
				</ClientContext>
			</QueryClientProvider>
		</ErrorBoundary>
	</React.StrictMode>,
);
