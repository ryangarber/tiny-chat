import { fileTypeFromStream } from "file-type";
import { Mime } from "mime";
import otherTypes from "mime/types/other.js";
import standardTypes from "mime/types/standard.js";
import { type CodeLanguage, CodeUtils } from "#core/core/utils/CodeUtils.ts";
import { FileUtils } from "#core/features/file/utils/FileUtils.ts";
import { PathUtils } from "#core/features/file/utils/PathUtils.ts";

const MIME = new Mime(standardTypes, otherTypes);

MIME.define({ "text/typescript": ["ts", "tsx", "mts", "cts"] }, true);
MIME.define({ "text/x-objcppsrc": ["mm"] }, true);
MIME.define({ "text/org": ["org"] }, true);
MIME.define({ "text/x-asciidoc": ["adoc", "asciidoc", "asc"] }, true);
MIME.define({ "text/x-rustsrc": ["rs"] }, true);
MIME.define({ "text/x-go": ["go"] }, true);
MIME.define({ "text/x-swift": ["swift"] }, true);
MIME.define({ "application/dart": ["dart"] }, true);
MIME.define({ "text/x-zig": ["zig", "zon"] }, true); // .zon = Zig package manifest
MIME.define({ "text/x-nim": ["nim", "nims", "nimble"] }, true);
MIME.define({ "text/x-crystal": ["cr"] }, true);
MIME.define({ "text/x-d": ["d", "di"] }, true); // .di = D interface file
MIME.define({ "text/x-odin": ["odin"] }, true);
MIME.define({ "text/x-verilog": ["v", "vh", "sv", "svh"] }, true);
MIME.define({ "text/x-kotlin": ["kt", "kts"] }, true);
MIME.define({ "text/x-scala": ["scala", "sc"] }, true);
MIME.define({ "text/x-groovy": ["groovy", "gvy", "gy", "gradle"] }, true);
MIME.define({ "text/x-haskell": ["hs", "lhs"] }, true);
MIME.define({ "text/x-ocaml": ["ml", "mli", "mly", "mll"] }, true);
MIME.define({ "text/x-fsharp": ["fs", "fsi", "fsx", "fsscript"] }, true);
MIME.define({ "text/x-elixir": ["ex", "exs", "heex", "leex"] }, true);
MIME.define({ "text/x-erlang": ["erl", "hrl", "escript"] }, true);
MIME.define({ "text/x-clojure": ["clj", "cljs", "cljc", "edn"] }, true);
MIME.define({ "text/x-elm": ["elm"] }, true);
MIME.define({ "text/x-purescript": ["purs"] }, true);
MIME.define({ "text/x-julia": ["jl"] }, true);
MIME.define({ "text/x-lua": ["lua"] }, true);
MIME.define({ "text/x-r": ["r", "rmd", "rnw", "rprofile"] }, true); // .R handled by case-insensitive FS
MIME.define({ "text/coffeescript": ["coffee", "litcoffee"] }, true);
MIME.define({ "text/x-perl": ["pl", "pm", "pod", "psgi"] }, true);
MIME.define({ "text/x-ruby": ["rb", "rake", "gemspec", "ru"] }, true);
MIME.define({ "text/x-python": ["py", "pyi", "pyw", "pyx", "pxd"] }, true); // .py already mapped
MIME.define({ "text/x-vue": ["vue"] }, true);
MIME.define({ "text/x-svelte": ["svelte"] }, true);
MIME.define({ "text/x-astro": ["astro"] }, true);
MIME.define({ "text/mdx": ["mdx"] }, true);
MIME.define({ "application/graphql": ["graphql", "gql"] }, true);
MIME.define({ "text/x-scss": ["scss"] }, true);
MIME.define({ "text/x-sass": ["sass"] }, true);
MIME.define({ "text/x-less": ["less"] }, true);
MIME.define({ "text/x-stylus": ["styl"] }, true);
MIME.define({ "application/toml": ["toml"] }, true); // RFC 9512
MIME.define({ "application/jsonc": ["jsonc"] }, true);
MIME.define({ "application/x-ndjson": ["jsonl", "ndjson"] }, true);
MIME.define({ "text/x-prisma": ["prisma"] }, true);
MIME.define({ "text/x-terraform": ["tf", "tfvars"] }, true);
MIME.define({ "text/x-hcl": ["hcl"] }, true);
MIME.define({ "text/x-nix": ["nix"] }, true);
MIME.define({ "text/x-bicep": ["bicep"] }, true);
MIME.define({ "text/x-dockerfile": ["dockerfile"] }, true); // for explicit .dockerfile files
MIME.define(
	{ "application/x-powershell": ["ps1", "psm1", "psd1", "ps1xml"] },
	true,
);
MIME.define(
	{
		"text/x-shellscript": [
			"bash",
			"bashrc",
			"bash_profile",
			"zsh",
			"zshrc",
			"zprofile",
			"fish",
			"ksh",
			"csh",
			"tcsh",
		],
	},
	true,
); // .sh already mapped
MIME.define({ "text/x-dotenv": ["env"] }, true);
MIME.define({ "text/x-arduino": ["ino"] }, true);
MIME.define({ "text/x-processing": ["pde"] }, true);
MIME.define({ "text/x-solidity": ["sol"] }, true);
MIME.define({ "text/x-vyper": ["vy"] }, true);
MIME.define({ "text/x-cairo": ["cairo"] }, true);
MIME.define({ "text/x-lean": ["lean"] }, true);
MIME.define({ "text/x-agda": ["agda"] }, true);
MIME.define({ "text/x-idris": ["idr", "lidr"] }, true);
MIME.define({ "text/x-rst": ["rst", "rest"] }, true);
MIME.define(
	{
		"text/other": [
			"gitignore",
			"gitconfig",
			"gitattributes",
			"gitmodules",
			"editorconfig",
			"prettierignore",
			"prettierrc",
			"eslintrc",
			"properties",
			"env",
		],
	},
	true,
);

export const FileTypeUtils = {
	mime: MIME,

	getMime: async ({
		data,
		path,
		fallback = "application/octet-stream",
	}: {
		data?: Blob | Uint8Array | string;
		path?: string[] | string;
		fallback?: string;
	}) => {
		let mime: string | undefined;

		if (data) {
			if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
			data = FileUtils.getBufferFromBytes({ data });

			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(data);
					controller.close();
				},
			});

			mime = (await fileTypeFromStream(stream))?.mime;
		}

		if (path) {
			const name = PathUtils.name({ path });
			mime ??= MIME.getType(name) ?? undefined;
		}

		return mime ?? fallback;
	},

	getMimeSync: ({
		path,
		fallback = "application/octet-stream",
	}: {
		path?: string[] | string;
		fallback?: string;
	}) => {
		let mime: string | undefined;

		if (path) {
			const name = PathUtils.name({ path });
			mime ??= MIME.getType(name) ?? undefined;
		}

		return mime ?? fallback;
	},

	getExtension: ({
		mime,
		name,
		path,
		fallback,
	}: {
		mime?: string;
		name?: string;
		path?: string[] | string;
		fallback?: string;
	}) => {
		let extension: string | undefined;

		if (mime) {
			extension = MIME.getExtension(mime) ?? undefined;
		}

		if (!path && name) path = [name];

		if (path) {
			const name = PathUtils.name({ path });

			mime = MIME.getType(name) ?? undefined;
			if (mime) extension ??= MIME.getExtension(mime) ?? undefined;

			extension ??= name.split(".").pop();
		}

		return extension ?? fallback;
	},

	/** Whether a file is written in Markdown, so reads as prose. */
	isMarkdown: (path: string) =>
		/\.(md|markdown|mdx)$/i.test(PathUtils.name({ path })),

	getLanguage: ({
		mime,
		name,
		path,
	}: {
		mime?: string;
		name?: string;
		path?: string[] | string;
	}): CodeLanguage | undefined => {
		if (!path && name) path = [name];

		if (path) {
			const name = PathUtils.name({ path });
			const exact = CodeUtils.getLanguage(name.split(".").at(-1) ?? null);
			if (exact) return exact;
		}

		const alias = FileTypeUtils.getExtension({ mime, name, path });
		if (!alias) return undefined;

		return CodeUtils.getLanguage(alias) ?? undefined;
	},

	getBom: ({ data }: { data: Uint8Array }) => {
		if (
			data[0] === 0xff &&
			data[1] === 0xfe &&
			data[2] === 0x00 &&
			data[3] === 0x00
		)
			return { encoding: "utf-32le", skip: 4 };

		if (
			data[0] === 0x00 &&
			data[1] === 0x00 &&
			data[2] === 0xfe &&
			data[3] === 0xff
		)
			return { encoding: "utf-32be", skip: 4 };

		if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
			return { encoding: "utf-8", skip: 3 };

		if (data[0] === 0xff && data[1] === 0xfe)
			return { encoding: "utf-16le", skip: 2 };

		if (data[0] === 0xfe && data[1] === 0xff)
			return { encoding: "utf-16be", skip: 2 };

		return null;
	},
};
