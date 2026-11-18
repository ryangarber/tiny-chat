import type { Bounds } from "better-ink-ui";
import type { DOMElement } from "ink";
import { create } from "zustand";
import type { SourceUtils } from "#core/features/data/utils/SourceUtils.ts";

type Citation = {
	id: string;
	/** The inline text the citation's emoji is drawn in. */
	node: DOMElement;
	/** Built only once the card opens: a web source's snippet is not free. */
	getSource: () => ReturnType<typeof SourceUtils.getDisplay>;
};

export type CitationStore = {
	/**
	 * Every citation on screen. Kept out of state, and mutated in place, so
	 * citations coming and going re-render nothing; only whether there are any
	 * at all is state, since that is what decides if clicks are listened for.
	 */
	citations: Set<Citation>;
	active: boolean;
	open: { citation: Citation; bounds: Bounds } | null;
	register: (citation: Citation) => () => void;
	setOpen: (open: CitationStore["open"]) => void;
};

export const useCitationStore = create<CitationStore>((set, get) => ({
	citations: new Set(),
	active: false,
	open: null,
	register: (citation) => {
		const { citations } = get();
		citations.add(citation);
		if (!get().active) set({ active: true });

		return () => {
			citations.delete(citation);
			const { open } = get();
			set({
				active: citations.size > 0,
				open: open?.citation === citation ? null : open,
			});
		};
	},
	setOpen: (open) => set({ open }),
}));
