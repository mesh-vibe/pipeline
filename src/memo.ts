import { postMemo as post } from "meshvibe-memo";

export function postMemo(
  title: string,
  body: string,
  opts: { tags?: string; related?: string } = {},
): void {
  try {
    const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()) : [];
    const related = opts.related ? opts.related.split(",").map((t) => t.trim()) : [];
    post(title, body, { author: "pipeline", tags, related });
  } catch {
    // fire-and-forget
  }
}
