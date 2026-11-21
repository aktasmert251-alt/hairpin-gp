// i18n dictionary types. A namespace file `<ns>.tr.ts` default-exports a nested object of strings;
// its `<ns>.en.ts` sibling is typed `DictOf<typeof tr>` so missing or extra keys fail typecheck.

export interface Dict { readonly [key: string]: string | Dict }

export type DictOf<T> = { [K in keyof T]: T[K] extends string ? string : DictOf<T[K]> };
