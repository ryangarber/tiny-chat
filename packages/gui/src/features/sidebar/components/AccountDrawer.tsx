import {
	Button,
	Divider,
	Drawer,
	Group,
	Modal,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import {
	GithubLogoIcon,
	GoogleLogoIcon,
	SmileyIcon,
} from "@phosphor-icons/react";
import { type JSX, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { useAccounts } from "#gui/core/hooks/useAccounts.ts";
import { useRuntime } from "#gui/core/hooks/useRuntime.ts";
import { useAppStore } from "#gui/core/stores/useAppStore.ts";
import { ControlUtils } from "#gui/core/utils/ControlUtils.ts";

function Account({
	providerId,
	name,
	icon,
}: {
	providerId: string;
	name: string;
	icon: JSX.Element;
}) {
	const { accounts, linkAccount, unlinkAccount } = useAccounts();

	const account = accounts.data?.find(
		(account) => account.providerId === providerId,
	);

	return (
		<Group justify="space-between">
			<Group gap={5}>
				{icon}
				<Text>{name}</Text>
			</Group>
			{account ? (
				accounts.data?.length === 1 ? (
					<Tooltip label="Must have one account">
						<Button variant="light" disabled>
							Unlink
						</Button>
					</Tooltip>
				) : (
					<Button
						variant="light"
						onClick={() => unlinkAccount.mutate(account.accountId)}
					>
						Unlink
					</Button>
				)
			) : (
				<Button
					variant="default"
					onClick={() => linkAccount.mutate(providerId)}
				>
					Link
				</Button>
			)}
		</Group>
	);
}

export default function AccountDrawer({
	opened,
	onClose,
}: {
	opened: boolean;
	onClose: () => void;
}) {
	const client = useContext(ClientContext);
	const runtime = useRuntime();

	const { session, requestClone } = useSession();
	const { deleteUser } = useAccounts();

	const currentModal = useAppStore((state) => state.currentModal);
	const setCurrentModal = useAppStore((state) => state.setCurrentModal);

	return (
		<Drawer
			opened={opened}
			onClose={onClose}
			title={
				session.data?.user && !session.data.user.isAnonymous
					? "Account"
					: "Sign In"
			}
		>
			<Stack>
				{runtime.platform !== "web" ? (
					<>
						{requestClone.isPending ? (
							<Text size="sm">Waiting for you to sign in...</Text>
						) : (
							<Text c="dimmed" size="sm">
								Use the web to sign in and manage your account.
							</Text>
						)}
						<Button
							variant="default"
							fullWidth
							onClick={() => {
								if (session.data?.user?.isAnonymous) {
									if (requestClone.isPending) {
										requestClone.reset();
									} else {
										requestClone.mutate(async (id) => {
											return await runtime.open(
												`${client.webUrl}/#?clone=${id}`,
											);
										});
									}
								} else {
									void runtime.open(`${client.webUrl}`);
								}
							}}
						>
							{requestClone.isPending ? "Cancel" : "Open Browser"}
						</Button>
						<Text size="xs" c="dimmed" m="0 auto">
							<Button
								size="compact-xs"
								variant="transparent"
								component="a"
								onClick={(e) => {
									e.preventDefault();
									if (session.data?.user?.isAnonymous) {
										if (!requestClone.isPending) {
											requestClone.mutate(async (id) => {
												await ControlUtils.copy({
													runtime,
													data: `${client.webUrl}/#?clone=${id}`,
													mime: "text/plain",
												});
											});
										}
									} else {
										void runtime.open(client.webUrl);
									}
								}}
							>
								or copy the link
							</Button>
						</Text>
					</>
				) : (
					<>
						<Text c="dimmed" size="sm">
							Link an account to save chats and settings.
						</Text>
						<Account
							providerId="google"
							name="Google"
							icon={<GoogleLogoIcon size={20} />}
						/>
						<Account
							providerId="github"
							name="GitHub"
							icon={<GithubLogoIcon size={20} />}
						/>
						<Account
							providerId="huggingface"
							name="Hugging Face"
							icon={<SmileyIcon size={20} />}
						/>
					</>
				)}
				{session.data?.user && !session.data.user.isAnonymous && (
					<>
						<Divider />
						<Button
							variant="default"
							fullWidth
							mt={10}
							onClick={() => {
								void (async () => {
									await client.auth.signOut();
									window.location.reload();
								})();
							}}
						>
							Sign Out
						</Button>
						<Button
							variant="outline"
							color="red"
							fullWidth
							mt={10}
							onClick={() => setCurrentModal("delete-account")}
						>
							Delete Account
						</Button>
						<Modal
							opened={currentModal === "delete-account"}
							onClose={() => setCurrentModal(null)}
							title="Delete Account"
							centered
						>
							<Button
								variant="outline"
								color="red"
								fullWidth
								onClick={() => {
									deleteUser.mutate();
								}}
								loading={deleteUser.isPending}
								disabled={deleteUser.isPending}
							>
								Confirm
							</Button>
						</Modal>
					</>
				)}
			</Stack>
		</Drawer>
	);
}
