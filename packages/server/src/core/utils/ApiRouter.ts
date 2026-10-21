import { testing } from "#server/core/routes/testing.ts";
import { subagent } from "#server/features/agent/routes/subagent.ts";
import { action } from "#server/features/chat/routes/action.ts";
import { chat } from "#server/features/chat/routes/chat.ts";
import { file } from "#server/features/chat/routes/file.ts";
import { memory } from "#server/features/chat/routes/memory.ts";
import { embedding } from "#server/features/embedding/routes/embedding.ts";
import { message } from "#server/features/message/routes/message.ts";
import { github } from "#server/features/proxy/routes/github.ts";
import { legiscan } from "#server/features/proxy/routes/legiscan.ts";
import { web } from "#server/features/proxy/routes/web.ts";
import { upload } from "#server/features/upload/routes/upload.ts";
import { settings } from "#server/features/user/routes/settings.ts";
import { user } from "#server/features/user/routes/user.ts";
import { router } from "#server/index.ts";

export const ApiRouter = router({
	user,
	chat,
	file,
	action,
	memory,
	subagent,
	upload,
	settings,
	embedding,
	message,
	web,
	github,
	legiscan,
	testing,
});

export type ApiRouter = typeof ApiRouter;
