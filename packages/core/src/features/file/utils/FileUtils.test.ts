import { FileUtils } from "#core/features/file/utils/FileUtils.ts";

describe("file content encoding", () => {
	it.each(["", "hello world", "<svg>100% & text</svg>", "東京 🌍 café\n"])(
		"encodes the UTF-8 bytes of %j as base64",
		(text) => {
			const encoded = FileUtils.getBase64FromText({ text });
			expect(encoded).toBe(Buffer.from(text, "utf8").toString("base64"));
			expect(FileUtils.getTextFromBytes({ data: encoded })).toBe(text);
		},
	);

	it("encodes large byte views without including their backing buffer or overflowing the stack", () => {
		const backing = new Uint8Array(200_010).fill(255);
		const data = backing.subarray(5, 200_005);
		data[0] = 0;
		const encoded = FileUtils.getBase64FromBytes({ data });
		expect(encoded).toBe(Buffer.from(data).toString("base64"));
		expect(FileUtils.getBufferFromBytes({ data: encoded })).toEqual(data);
	});

	it("decodes only a sliced Buffer's bytes", () => {
		const buffer = Buffer.from("private|hello|private");
		expect(FileUtils.getTextFromBytes({ data: buffer.subarray(8, 13) })).toBe(
			"hello",
		);
	});

	it("uses an explicit charset and falls back when that charset is invalid", () => {
		expect(
			FileUtils.getTextFromBytes({
				data: new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
				mime: 'text/plain; charset="windows-1252"',
			}),
		).toBe("café");
		expect(
			FileUtils.getTextFromBytes({
				data: new TextEncoder().encode("東京"),
				mime: "text/plain; charset=invalid",
			}),
		).toBe("東京");
	});

	it("recognizes a UTF-16 BOM and returns null for undecodable binary", () => {
		expect(
			FileUtils.getTextFromBytes({
				data: new Uint8Array([0xff, 0xfe, 0x41, 0, 0x42, 0]),
			}),
		).toBe("AB");
		expect(
			FileUtils.getTextFromBytes({ data: new Uint8Array([0xff, 0x80, 0xff]) }),
		).toBeNull();
	});
});
