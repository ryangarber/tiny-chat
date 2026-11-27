import {
	environmentManager,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import "#client/client.ts";

describe("createClient's Query environment", () => {
	afterEach(() => vi.useRealTimers());

	it("is a client without a window", () => {
		expect("window" in globalThis).toBe(false);
		expect(environmentManager.isServer()).toBe(false);
	});

	it("schedules refetchInterval and keeps Query's client defaults", async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient();
		const queryFn = vi.fn(async () => 1);
		const observer = new QueryObserver(queryClient, {
			queryKey: ["poll"],
			queryFn,
			refetchInterval: 1000,
		});
		const unsubscribe = observer.subscribe(() => {});

		await vi.advanceTimersByTimeAsync(3500);
		expect(queryFn).toHaveBeenCalledTimes(4);

		const query = queryClient.getQueryCache().find({ queryKey: ["poll"] });
		expect(query?.gcTime).toBe(5 * 60 * 1000);

		unsubscribe();
		queryClient.clear();
	});
});
