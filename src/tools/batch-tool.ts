import { z } from 'zod';
import type { ToolContext, ToolDef } from './registry.js';
import { textResult, type ToolTextResult } from './result.js';

export const MAX_BATCH_OPERATIONS = 1000;
const HEAD_LINES = 20;
const TAIL_LINES = 5;
const MAX_REPORTED_PROBLEMS = 10;

export interface BatchOperation {
  tool: string;
  args?: Record<string, unknown>;
}

function errorResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function firstLine(text: string): string {
  return text.split('\n')[0];
}

/**
 * Validates every operation against its tool's own schema first, then runs
 * them in order. A runtime failure stops the batch but keeps what was applied.
 * Saving is the caller's job (the server wraps the whole batch in one withSave).
 */
export function batchHandler(
  ctx: ToolContext,
  args: { operations: BatchOperation[] },
  defs: readonly ToolDef[]
): ToolTextResult {
  const operations = args.operations;
  if (operations.length < 1 || operations.length > MAX_BATCH_OPERATIONS) {
    return errorResult(`A batch must contain between 1 and ${MAX_BATCH_OPERATIONS} operations, got ${operations.length}.`);
  }

  const problems: string[] = [];
  const prepared: { def: ToolDef; args: unknown }[] = [];
  operations.forEach((op, i) => {
    const label = `operation ${i + 1} (${op.tool})`;
    const def = defs.find((d) => d.name === op.tool);
    if (!def) {
      problems.push(`${label}: unknown tool.`);
      return;
    }
    if (!def.batchable) {
      problems.push(`${label}: this tool cannot be used inside a batch.`);
      return;
    }
    const parsed = z.object(def.inputShape()).safeParse(op.args ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const where = issue.path.length > 0 ? issue.path.join('.') : '(arguments)';
        problems.push(`${label}: ${where}: ${issue.message}`);
      }
      return;
    }
    prepared.push({ def, args: parsed.data });
  });
  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_REPORTED_PROBLEMS);
    const extra = problems.length > shown.length ? `\n... and ${problems.length - shown.length} more problem(s).` : '';
    return errorResult(`Batch rejected, no operation was run:\n${shown.join('\n')}${extra}`);
  }

  const lines: string[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const { def, args: opArgs } = prepared[i];
    const failure = (message: string) =>
      errorResult(
        `Batch stopped at operation ${i + 1} (${def.name}): ${message} ` +
          `${i} of ${prepared.length} operations applied; those changes were kept.`
      );
    let result: ToolTextResult;
    try {
      const out = def.run(ctx, opArgs);
      if (out instanceof Promise) return failure('tool returned an asynchronous result, which a batch cannot run.');
      result = out;
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
    const text = result.content[0]?.text ?? '';
    if (result.isError) return failure(firstLine(text));
    lines.push(`${i + 1}. ${def.name}: ${firstLine(text)}`);
  }

  const shown =
    lines.length > HEAD_LINES + TAIL_LINES
      ? [
          ...lines.slice(0, HEAD_LINES),
          `... (${lines.length - HEAD_LINES - TAIL_LINES} more) ...`,
          ...lines.slice(lines.length - TAIL_LINES)
        ]
      : lines;
  return textResult(`Applied ${lines.length} operation(s).\n${shown.join('\n')}`);
}
