export interface ToolTextResult {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}
