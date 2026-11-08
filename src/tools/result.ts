export interface ToolTextResult {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** A tool result that may carry images next to text (renderView). */
export interface ToolImageResult {
  [x: string]: unknown;
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
  isError?: boolean;
}

export type ToolResult = ToolTextResult | ToolImageResult;

export function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}
