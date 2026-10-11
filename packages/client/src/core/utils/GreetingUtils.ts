export type GreetingTimeOfDay =
	| "morning"
	| "afternoon"
	| "evening"
	| "overnight";

export const GreetingUtils = {
	/**
	 * Bucket a date into a rough time-of-day, used to pick a fitting greeting.
	 */
	getTimeOfDay: (date: Date = new Date()): GreetingTimeOfDay => {
		const hour = date.getHours();
		if (hour >= 6 && hour < 12) return "morning";
		if (hour >= 12 && hour < 18) return "afternoon";
		if (hour >= 18 && hour < 22) return "evening";
		return "overnight";
	},

	/**
	 * Get a short, friendly greeting for the empty/new-chat state, optionally
	 * personalized with the user's first name.
	 */
	get: ({
		name,
		date = new Date(),
	}: {
		name?: string;
		date?: Date;
	} = {}): string => {
		const time = GreetingUtils.getTimeOfDay(date);
		const greetings: string[] = [];

		const add = (withName: string, withoutName: string) => {
			if (name) greetings.push(withName.replace("@", name));
			else greetings.push(withoutName);
		};

		if (time === "morning" || time === "afternoon") {
			add("@ returns", "Hi there");
			add("Let's get to it, @", "Let's get to it");
			add("What's the plan, @", "What's the plan?");
		} else if (time === "evening") {
			add("@'s still at it", "Still at it");
			add("@ working late?", "Working late?");
			add("What's next for @?", "What's next?");
		} else {
			add("@ the night owl", "Hi night owl");
			add("No sleep for @", "No sleep for you");
			add("Up late, @?", "Up late?");
		}

		return greetings[Date.now() % greetings.length].replace("@", name ?? "");
	},
} as const;
