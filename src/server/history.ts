import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiFormat, PromptHistoryEntry } from '../types';

export interface RequestDetails {
  model?: string;
  prompt: string;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        const candidate = part as { text?: unknown; content?: unknown; input_text?: unknown };
        return contentToText(candidate.text ?? candidate.input_text ?? candidate.content ?? '');
      }
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object') {
    const candidate = content as { text?: unknown; content?: unknown; output_text?: unknown };
    return contentToText(candidate.text ?? candidate.output_text ?? candidate.content ?? '');
  }
  return '';
}

function parseJson(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function extractRequestDetails(body: string): RequestDetails | undefined {
  if (!body.trim()) return undefined;

  const parsed = parseJson(body);
  if (!parsed) return { prompt: body };
  if (Object.keys(parsed).length === 0) return undefined;

  const model = typeof parsed.model === 'string' ? parsed.model : undefined;
  if (Array.isArray(parsed.messages)) {
    const userMessages = parsed.messages.filter((message) => (
      message && typeof message === 'object' && (message as { role?: unknown }).role === 'user'
    ));
    const lastUser = userMessages[userMessages.length - 1] as { content?: unknown } | undefined;
    return { model, prompt: contentToText(lastUser?.content ?? '') };
  }
  if (typeof parsed.input === 'string') return { model, prompt: parsed.input };
  if (Array.isArray(parsed.input)) return { model, prompt: contentToText(parsed.input) };
  if (typeof parsed.prompt === 'string') return { model, prompt: parsed.prompt };
  return { model, prompt: body };
}

function collectJsonText(parsed: Record<string, unknown>): string {
  const choices = parsed.choices;
  if (Array.isArray(choices)) {
    return choices.map((choice) => {
      if (!choice || typeof choice !== 'object') return '';
      const candidate = choice as { message?: unknown; delta?: unknown; text?: unknown };
      return contentToText(candidate.message ?? candidate.delta ?? candidate.text ?? '');
    }).filter(Boolean).join('');
  }
  if (typeof parsed.output_text === 'string') return parsed.output_text;
  if (Array.isArray(parsed.content)) return contentToText(parsed.content);
  if (Array.isArray(parsed.output)) return contentToText(parsed.output);
  return '';
}

function collectSseText(body: string): string {
  const parts: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object') continue;
      const event = parsed as Record<string, unknown>;
      const choices = event.choices;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          if (choice && typeof choice === 'object') {
            const candidate = choice as { delta?: unknown; text?: unknown };
            const text = contentToText(candidate.delta ?? candidate.text ?? '');
            if (text) parts.push(text);
          }
        }
      }
      const delta = event.delta;
      if (delta && typeof delta === 'object') {
        const text = contentToText((delta as { text?: unknown }).text ?? '');
        if (text) parts.push(text);
      }
      if (typeof delta === 'string') parts.push(delta);
      for (const key of ['output_text', 'text']) {
        if (typeof event[key] === 'string') parts.push(event[key] as string);
      }
    } catch {
      // Ignore non-JSON SSE comments and partial events.
    }
  }
  return parts.join('');
}

export function extractResponseText(body: string): string {
  const parsed = parseJson(body);
  const jsonText = parsed ? collectJsonText(parsed) : '';
  if (jsonText) return jsonText;
  const sseText = collectSseText(body);
  return sseText || body;
}

export function appendPromptHistory(directory: string, entry: PromptHistoryEntry): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(path.join(directory, `${entry.provider}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function createHistoryEntry(
  provider: string,
  format: ApiFormat,
  request: RequestDetails,
  responseBody: string,
  status: number,
  durationMs: number,
): PromptHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    provider,
    format,
    ...(request.model ? { model: request.model } : {}),
    prompt: request.prompt,
    response: extractResponseText(responseBody).slice(0, 200_000),
    status,
    durationMs: Number(durationMs.toFixed(2)),
  };
}
