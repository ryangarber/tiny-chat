import {
	Badge,
	Box,
	Button,
	Checkbox,
	Grid,
	Group,
	Radio,
	Stack,
	Text,
	Textarea,
} from "@mantine/core";
import { useToolFeedback } from "#client/features/part/hooks/useToolFeedback.ts";
import type { MessageState } from "#core/features/data/types/message.ts";
import type { zToolCallPart } from "#core/features/data/types/part.ts";
import type { ToolControls as ToolControlsType } from "#core/features/tool/types/display.ts";

/** What the user answers a tool call with: its fields, then approve or continue. */
export default function ToolControls({
	message,
	part,
	controls,
	answerable,
}: {
	message: MessageState;
	part: zToolCallPart;
	controls: ToolControlsType;
	/** Only calls waiting on the user can be answered, in any order. */
	answerable?: boolean;
}) {
	const {
		values,
		setValue,
		toggle,
		isPicked,
		submit,
		locked,
		complete,
		sending,
	} = useToolFeedback({ message, part, controls });

	const disabled = locked || !answerable;

	return (
		<Stack gap="xs">
			{controls.fields.map((field) => (
				<Stack key={field.name} gap="xs">
					{(field.label || field.header) && (
						<Group gap="xs" wrap="nowrap" align="baseline">
							{field.header && (
								<Badge size="sm" variant="light" style={{ flexShrink: 0 }}>
									{field.header}
								</Badge>
							)}
							{field.label && <Text fw={500}>{field.label}</Text>}
						</Group>
					)}
					{field.options.length > 0 && (
						<Grid grow>
							{field.options.map((option) => {
								const content = (
									<Box>
										<Text>{option.label}</Text>
										{option.description && (
											<Text size="sm" c="dimmed">
												{option.description}
											</Text>
										)}
									</Box>
								);
								return (
									<Grid.Col key={option.label} span={4} align="stretch">
										{field.multiple ? (
											<Checkbox.Card
												p="md"
												h="100%"
												checked={isPicked(field.name, option.label)}
												disabled={disabled}
												onClick={() => toggle(field.name, option.label)}
											>
												<Group wrap="nowrap" align="flex-start" h="100%">
													<Checkbox.Indicator />
													{content}
												</Group>
											</Checkbox.Card>
										) : (
											<Radio.Card
												p="md"
												h="100%"
												checked={values[field.name] === option.label}
												disabled={disabled}
												onClick={() => setValue(field.name, option.label)}
											>
												<Group wrap="nowrap" align="flex-start" h="100%">
													<Radio.Indicator />
													{content}
												</Group>
											</Radio.Card>
										)}
									</Grid.Col>
								);
							})}
						</Grid>
					)}
					{field.custom && (
						<Textarea
							autosize
							minRows={1}
							maxRows={10}
							placeholder={field.placeholder}
							value={values[field.name] ?? ""}
							disabled={disabled}
							onChange={(event) => setValue(field.name, event.target.value)}
						/>
					)}
				</Stack>
			))}
			<Group gap="xs" justify="flex-end">
				{controls.approval ? (
					<>
						<Button
							size="xs"
							variant="default"
							onClick={() => submit(false)}
							loading={sending === false}
							disabled={disabled}
						>
							Deny
						</Button>
						<Button
							size="xs"
							onClick={() => submit(true)}
							loading={sending === true}
							disabled={disabled || !complete}
						>
							Approve
						</Button>
					</>
				) : (
					<Button
						size="xs"
						onClick={() => submit()}
						loading={sending !== undefined}
						disabled={disabled || !complete}
					>
						Continue
					</Button>
				)}
			</Group>
		</Stack>
	);
}
