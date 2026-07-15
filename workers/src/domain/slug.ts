/** Slug z názvu - ekvivalent Django slugify() (včetně odstranění diakritiky). */

// Kombinující diakritická znaménka, která po NFKD rozkladu zůstanou
// viset za základním písmenem ("á" -> "a" + U+0301).
const COMBINING_MARKS = /[̀-ͯ]/g;

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
