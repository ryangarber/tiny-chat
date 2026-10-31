import ToolBlock from "#gui/features/part/components/ToolBlock.tsx";
import { render } from "#gui/tests.ts";

/** A one-page PDF reading "Tiny PDF text". */
const PDF =
	"JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMTAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0MyA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDEwIDUwIFRkIChUaW55IFBERiB0ZXh0KSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMzNCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQwNAolJUVPRgo=";

describe("tool blocks", () => {
	it("labels code blocks with their title", async () => {
		const screen = await render(
			<ToolBlock
				block={{ type: "code", value: "ls", language: "bash", title: "input" }}
				active={false}
			/>,
		);
		await expect.element(screen.getByText("input")).toBeInTheDocument();
	});

	it("shows a document's extracted text", async () => {
		const screen = await render(
			<ToolBlock
				block={{
					type: "file",
					path: "/docs/tiny.pdf",
					document: { data: PDF, mime: "application/pdf" },
					language: "markdown",
				}}
				active={false}
			/>,
		);
		await expect
			.element(screen.getByText("Tiny PDF text"), { timeout: 15_000 })
			.toBeInTheDocument();
		await expect
			.element(screen.getByText("/docs/tiny.pdf"))
			.toBeInTheDocument();
	});
});
