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
import { useIsMutating, useMutationState } from "@tanstack/react-query";
import { type JSX, useContext } from "react";
import { ClientContext } from "#client/client.ts";
import { useSession } from "#client/core/hooks/useSession.ts";
import { linkAccountKey, useAccounts } from "#gui/core/hooks/useAccounts.ts";
import { getHashbangQuery } from "#gui/core/hooks/useHashbang.ts";
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
	const { deleteUser, cancelLink } = useAccounts();

	const signedIn = !!session.data?.user && !session.data.user.isAnonymous;
	// Signing in here: on the web, or in an app that receives its URL scheme;
	// any other app borrows the web's session (see `CloneService`).
	const direct = runtime.platform === "web" || !!runtime.auth;
	const cloneUrl = (id: string) => `${client.webUrl}/#/?clone=${id}`;
	const linking = useIsMutating({ mutationKey: linkAccountKey }) > 0;
	const linkError = useMutationState({
		filters: { mutationKey: linkAccountKey },
		select: (mutation) => mutation.state.error,
	}).at(-1);
	const cloning = !!getHashbangQuery().clone;
	const cloned =
		useMutationState({
			filters: { mutationKey: ["useSession", "acceptClone"] },
			select: (mutation) => mutation.state.status,
		}).at(-1) === "success";

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
				{cloned ? (
					<Text size="sm">Your other device is signed in.</Text>
				) : cloning && !signedIn ? (
					<Text size="sm">
						Sign in to finish signing in to Tiny Chat on your other device.
					</Text>
				) : null}
				{direct ? (
					<>
						{linking ? (
							<Group justify="space-between">
								<Text size="sm">Finish signing in in your browser...</Text>
								<Button variant="default" onClick={cancelLink}>
									Cancel
								</Button>
							</Group>
						) : (
							<Text c="dimmed" size="sm">
								Link an account to save chats and settings.
							</Text>
						)}
						{linkError && !linking && (
							<Text c="red" size="sm">
								{linkError.message}
							</Text>
						)}
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
						{runtime.platform !== "web" &&
							session.data?.user?.isAnonymous &&
							(requestClone.isPending ? (
								<Group justify="space-between">
									<Text size="sm">
										Waiting for you to sign in on the web...
									</Text>
									<Button
										variant="default"
										onClick={() => requestClone.reset()}
									>
										Cancel
									</Button>
								</Group>
							) : (
								<Text size="xs" c="dimmed" m="0 auto">
									<Button
										size="compact-xs"
										variant="transparent"
										component="a"
										onClick={(e) => {
											e.preventDefault();
											requestClone.mutate(async (id) => {
												await runtime.open(cloneUrl(id));
											});
										}}
									>
										or sign in on the web
									</Button>
								</Text>
							))}
					</>
				) : (
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
											return await runtime.open(cloneUrl(id));
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
													data: cloneUrl(id),
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
