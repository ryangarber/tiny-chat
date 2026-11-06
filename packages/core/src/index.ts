const _fm = await import("front-matter");
// biome-ignore lint/suspicious/noTsIgnore: false negative
// @ts-ignore
export const fm = _fm.default?.default ?? _fm.default;

const _flourite = await import("flourite");
// biome-ignore lint/suspicious/noTsIgnore: false negative
// @ts-ignore
export const flourite = _flourite.default?.default ?? _flourite.default;
