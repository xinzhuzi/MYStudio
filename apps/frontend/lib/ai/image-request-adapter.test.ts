import { describe, expect, it } from 'vitest';
import {
  buildChatCompletionsImageRequest,
  extractChatCompletionsImageUrl,
  parseChatCompletionsImageResponseText,
} from './image-request-adapter';

describe('image request adapter', () => {
  it('builds deterministic multimodal payload with references', () => {
    const body = buildChatCompletionsImageRequest({ model: 'gemini-2.5-flash-image', prompt: 'stone', aspectRatio: '16:9', resolution: '2K', referenceImages: ['data:image/png;base64,x'] });
    expect(body).toMatchObject({ model: 'gemini-2.5-flash-image', stream: false, aspect_ratio: '16:9' });
    expect((body.messages as any)[0].content).toHaveLength(2);
  });

  it('extracts inline and markdown image forms', () => {
    expect(extractChatCompletionsImageUrl({ choices: [{ message: { content: [{ type: 'image', data: 'abc' }] } }] })).toBe('data:image/png;base64,abc');
    expect(extractChatCompletionsImageUrl({ choices: [{ message: { content: '![x](https://cdn.test/a.png)' } }] })).toBe('https://cdn.test/a.png');
    expect(extractChatCompletionsImageUrl({ choices: [{ message: { content: 'done https://cdn.test/a.webp ok' } }] })).toBe('https://cdn.test/a.webp');
  });

  it('parses ordinary JSON response text', () => {
    const parsed = parseChatCompletionsImageResponseText(JSON.stringify({
      choices: [{ message: { content: '![x](https://cdn.test/json.png)' } }],
    }));

    expect(extractChatCompletionsImageUrl(parsed)).toBe('https://cdn.test/json.png');
  });

  it('reconstructs SSE delta text into a standard chat response', () => {
    const parsed = parseChatCompletionsImageResponseText([
      'data: {"choices":[{"delta":{"content":"![x](https://cdn.test/"}}]}',
      'data: {"choices":[{"delta":{"content":"stream.png)"}}]}',
      'data: [DONE]',
    ].join('\n'));

    expect(extractChatCompletionsImageUrl(parsed)).toBe('https://cdn.test/stream.png');
  });

  it('prefers SSE delta text over cumulative message snapshots', () => {
    const parsed = parseChatCompletionsImageResponseText([
      'data: {"choices":[{"delta":{"content":"![x](https://cdn.test/"},"message":{"content":"![x](https://cdn.test/"}}]}',
      'data: {"choices":[{"delta":{"content":"delta.png)"},"message":{"content":"![x](https://cdn.test/snapshot.png)"}}]}',
      'data: [DONE]',
    ].join('\n'));

    expect((parsed as { choices: Array<{ message: { content: string } }> }).choices[0].message.content)
      .toBe('![x](https://cdn.test/delta.png)');
    expect(extractChatCompletionsImageUrl(parsed)).toBe('https://cdn.test/delta.png');
  });

  it('keeps streamed text when SSE also includes array parts', () => {
    const parsed = parseChatCompletionsImageResponseText([
      'data:{"choices":[{"delta":{"content":"![x](https://cdn.test/mixed.png)"}}]}',
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"metadata"}]}}]}',
      'data: [DONE]',
    ].join('\n'));

    expect(extractChatCompletionsImageUrl(parsed)).toBe('https://cdn.test/mixed.png');
  });

  it('uses the latest cumulative message snapshot in message-only SSE streams', () => {
    const parsed = parseChatCompletionsImageResponseText([
      'data: {"choices":[{"message":{"content":"![x](https://cdn.test/"}}]}',
      'data: {"choices":[{"message":{"content":"![x](https://cdn.test/message.png)"}}]}',
      'data: [DONE]',
    ].join('\n'));

    expect((parsed as { choices: Array<{ message: { content: string } }> }).choices[0].message.content)
      .toBe('![x](https://cdn.test/message.png)');
    expect(extractChatCompletionsImageUrl(parsed)).toBe('https://cdn.test/message.png');
  });

  it('keeps SSE array image parts when providers stream multimodal content', () => {
    const parsed = parseChatCompletionsImageResponseText([
      'data: {"choices":[{"delta":{"content":[{"type":"image","data":"abc"}]}}]}',
      'data: [DONE]',
    ].join('\n'));

    expect(extractChatCompletionsImageUrl(parsed)).toBe('data:image/png;base64,abc');
  });

  it('parses CRLF-delimited SSE response text', () => {
    const parsed = parseChatCompletionsImageResponseText([
      'data: {"choices":[{"delta":{"content":"![x](https://cdn.test/"}}]}',
      'data: {"choices":[{"delta":{"content":"crlf.png)"}}]}',
      'data: [DONE]',
    ].join('\r\n'));

    expect(extractChatCompletionsImageUrl(parsed)).toBe('https://cdn.test/crlf.png');
  });

  it('extracts image URLs from multimodal text parts', () => {
    expect(extractChatCompletionsImageUrl({
      choices: [{
        message: {
          content: [{ type: 'text', text: 'asset: https://cdn.test/part.png' }],
        },
      }],
    })).toBe('https://cdn.test/part.png');
  });
});
