import { z } from "zod";
import type { DeepPartial } from "#core/core/types/common.ts";
import type {
	ToolBlock,
	ToolDisplay,
	ToolField,
} from "#core/features/tool/types/display.ts";
import type {
	Tool,
	ToolDefinition,
	ToolFactory,
} from "#core/features/tool/types/tool.ts";

const zQuestion = z.object({
	question: z
		.string()
		.describe(
			"The complete question, clear and specific, ending with a question mark.",
		),
	header: z
		.string()
		.optional()
		.describe('A very short label for it, up to 12 characters: "Approach".'),
	options: z
		.array(
			z.object({
				label: z.string().describe("The choice, in 1-5 words."),
				description: z
					.string()
					.optional()
					.describe("What picking it means, or its tradeoffs."),
			}),
		)
		.max(4)
		.default([])
		.describe(
			"Up to 4 distinct choices. Leave out an 'Other' choice: the user can always write their own answer.",
		),
	multiSelect: z
		.boolean()
		.default(false)
		.describe("Whether the user can pick more than one choice."),
});

export const ask_question = {
	name: "ask_question",
	description:
		"Ask the user up to 4 questions mid-response, each with choices to pick from. Their answers come back as the result.",
	input: z.object({
		questions: z.array(zQuestion).min(1).max(4),
	}),
	feedback: z.record(z.string(), z.string()),
	output: z.object({
		answers: z.record(z.string(), z.string()),
	}),
} as const satisfies ToolDefinition;

type Question = DeepPartial<z.infer<typeof zQuestion>>;

/** Where a call's answer to its `index`th question is sent, in its feedback. */
const field = (index: number) => `q${index}`;

/**
 * The questions a call asks. Calls made before it took several were one
 * `question` with `suggestions`.
 */
const getQuestions = (input: unknown): Question[] => {
	const value = (input ?? {}) as {
		questions?: Question[];
		question?: string;
		suggestions?: string[];
	};
	if (Array.isArray(value.questions))
		return value.questions.filter((question) => !!question);
	if (typeof value.question === "string")
		return [
			{
				question: value.question,
				options: (value.suggestions ?? []).map((label) => ({ label })),
			},
		];
	return [];
};

/** The answers from the user's feedback, by question. */
const getAnswers = (
	input: unknown,
	feedback: Record<string, string> | undefined,
): Record<string, string> =>
	Object.fromEntries(
		getQuestions(input).flatMap((question, index) => {
			const answer = feedback?.[field(index)];
			return question.question && answer ? [[question.question, answer]] : [];
		}),
	);

const answerBlocks = (answers: Record<string, string>): ToolBlock[] => {
	const entries = Object.entries(answers);
	return entries.map(([question, answer]) => ({
		type: "markdown",
		value: entries.length > 1 ? `**${question}**\n\n${answer}` : answer,
		quote: true,
	}));
};

/**
 * How a call asking the user questions is shown and answered. Shared with
 * Claude Code's `AskUserQuestion`, which asks in the same shape and reads
 * its answers back from `answers` in its input.
 */
export const askQuestionDisplay: ToolDisplay<ToolDefinition> = {
	status: ({ input }) => {
		const questions = getQuestions(input);
		return [
			["Asking", "Asked"],
			{
				count: ["question", "questions"],
				subject:
					questions.length === 1
						? (questions[0].question ?? "")
						: `${questions.length} questions`,
			},
		];
	},
	input: ({ input }) => {
		const questions = getQuestions(input);
		// With several, each question heads its own field instead.
		return questions.length === 1
			? [{ type: "markdown", value: questions[0].question ?? "" }]
			: [];
	},
	fields: ({ input }) => {
		const questions = getQuestions(input);
		return questions.map(
			(question, index): ToolField => ({
				type: "choice",
				name: field(index),
				label: questions.length > 1 ? question.question : undefined,
				header: question.header,
				options: (question.options ?? []).flatMap((option) =>
					option?.label
						? [{ label: option.label, description: option.description }]
						: [],
				),
				multiple: !!question.multiSelect,
				custom: true,
				placeholder: "Something else…",
			}),
		);
	},
	output: ({ input, output }) => {
		const [result] = output as {
			answers?: Record<string, string>;
			answer?: string;
		}[];
		if (result?.answers) return answerBlocks(result.answers);
		// Answered before calls took several questions.
		if (result?.answer) return answerBlocks({ "": result.answer });
		const answers = (input as { answers?: Record<string, string> }).answers;
		return answers ? answerBlocks(answers) : [];
	},
};

export const createAskQuestionTool: ToolFactory<
	Tool<typeof ask_question, void>
> = (options) => ({
	...ask_question,
	...options,
	display: askQuestionDisplay as ToolDisplay<typeof ask_question>,
	execute: async ({ input, feedback }) => {
		return [{ type: "json", value: { answers: getAnswers(input, feedback) } }];
	},
});

export const AskQuestionUtils = { getQuestions, getAnswers } as const;
