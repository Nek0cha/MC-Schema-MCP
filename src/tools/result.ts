export interface ToolTextResult {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
}

export function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}
