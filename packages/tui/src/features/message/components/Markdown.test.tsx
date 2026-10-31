import Markdown from "#tui/features/message/components/Markdown.tsx";
import render from "#tui/tests.ts";

/**
 * Markdown as it is found in the wild — READMEs most of all — which Ink would
 * otherwise refuse to lay out: an image (a box) inside a link (text), bare
 * text inside an HTML block, or a tag Ink has no element for.
 */
const SOURCES: Record<string, string> = {
	"badge in a link": "[![CI](https://example.com/ci.svg)](https://example.com)",
	"image in emphasis":
		"*![x](https://example.com/x.png)* and **![y](https://example.com/y.png)**",
	"centered div":
		'<div align="center">\n<img src="https://example.com/logo.png">\n<h1>Title</h1>\n</div>',
	"text in a div": '<div align="center">hello <b>bold</b></div>',
	"badges in a paragraph":
		'<p align="center"><a href="https://x"><img src="https://example.com/a.png"></a></p>',
	"inline tags":
		"Press <kbd>Ctrl</kbd> + <b>C</b>, <i>i</i> <span>s</span> <ins>u</ins> <s>x</s> <q>q</q>",
	"definition list": "<dl><dt>Term</dt><dd>Definition</dd></dl>",
	picture:
		'<picture><source srcset="a.png"><img src="https://example.com/b.png"></picture>',
	"image in a table":
		"| a | b |\n|---|---|\n| `x` | ![i](https://example.com/i.png) |",
	"HTML table":
		"<table><tr><td><img src='https://example.com/i.png'></td><td><ul><li>x</li></ul></td></tr></table>",
	"image in a heading link":
		"## [![logo](https://example.com/l.png)](https://x) Title",
	"math in bold": "Inline $$x^2$$ and **$$y$$**",
	ruby: "<ruby>漢<rt>kan</rt></ruby> <sub>![i](https://example.com/i.png)</sub>",
	"pre without code": "<pre>plain</pre>",
	"nested divs": "<div><div><p>text</p>raw</div>tail</div>",
	media: '<video src="x.mp4"></video><audio src="a.mp3"></audio>',
};

describe("Markdown", () => {
	for (const [name, source] of Object.entries(SOURCES)) {
		it(`draws ${name}`, async () => {
			const screen = await render(<Markdown source={source} />);
			await screen.idle();
			const frame = screen.lastFrame() ?? "";
			screen.cleanup();
			expect(frame).not.toMatch(/ERROR|Couldn’t draw/);
		});
	}

	it("draws an image inside a link as its alt text", async () => {
		const screen = await render(
			<Markdown source="[![build passing](https://example.com/ci.svg)](https://example.com)" />,
		);
		await screen.idle();
		expect(screen.lastFrame()).toContain("[build passing]");
		screen.cleanup();
	});
});
