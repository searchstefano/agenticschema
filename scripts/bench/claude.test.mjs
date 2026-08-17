import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOLS,
  buildArgs,
  isUsageLimit,
  judgePrompt,
  labelPrompt,
  neutralLabelPrompt,
  readResult,
  textPrompt,
  toolsPrompt,
} from './claude.mjs';

const PROTOCOL = 'Answer with the value alone.';

describe('prompts', () => {
  it('gives the text arm the page and the tools arm the url', () => {
    const text = textPrompt({
      url: 'https://example.test/p/1',
      text: 'Billy bookcase EUR 129.90',
      question: 'What does it cost?',
      protocol: PROTOCOL,
    });
    const tools = toolsPrompt({
      url: 'https://example.test/p/1',
      question: 'What does it cost?',
      protocol: PROTOCOL,
    });

    expect(text).toContain('Billy bookcase EUR 129.90');
    // The whole design of the comparison is that the tools arm cannot see the
    // page. A prompt that leaked the text into it would produce two arms
    // measuring the same thing and a difference of zero to explain.
    expect(tools).not.toContain('Billy bookcase');
    expect(tools).toContain('https://example.test/p/1');

    for (const prompt of [text, tools]) {
      expect(prompt).toContain(PROTOCOL);
      expect(prompt).toContain('What does it cost?');
      // Both arms carry the same instruction not to answer from memory of the
      // site. Otherwise a well-known shop is answerable without either input.
      expect(prompt).toContain('Do not guess');
    }
  });

  it('writes the key from the text alone, never from the markup', () => {
    const prompt = labelPrompt({
      url: 'https://example.test/p/1',
      text: 'Billy bookcase EUR 129.90',
      question: 'What does it cost?',
      protocol: PROTOCOL,
    });
    expect(prompt).toContain('Billy bookcase EUR 129.90');
    expect(prompt).toContain('NOT_ON_PAGE');
  });

  it('shows the neutral labeller both views, and says neither outranks the other', () => {
    // The text-only key puts a ceiling on the tools arm: its best possible
    // result is repeating the prose. This is the key that can say which input
    // answers more of what the page knows, so both views have to count.
    const prompt = neutralLabelPrompt({
      url: 'https://example.test/p/1',
      text: 'Billy bookcase',
      structured: '{"@type":"Product","name":"Billy","offers":{"price":129.9}}',
      question: 'What does it cost?',
      protocol: PROTOCOL,
    });

    expect(prompt).toContain('Billy bookcase');
    expect(prompt).toContain('"price":129.9');
    expect(prompt).toContain('equally valid');
    expect(prompt).toContain('NOT_ON_PAGE');
  });

  it('says so plainly when a page publishes no data at all', () => {
    // Left blank, the labeller would be shown an empty section and invited to
    // read something into it.
    const prompt = neutralLabelPrompt({
      url: 'https://example.test/p/1',
      text: 'solo prosa',
      structured: '',
      question: 'What does it cost?',
      protocol: PROTOCOL,
    });
    expect(prompt).toContain('(the page publishes none)');
  });

  it('shows the judge the two answers and asks for one word', () => {
    const prompt = judgePrompt({ question: 'Price?', key: 'EUR 129.90', answer: '129,90 €' });
    expect(prompt).toContain('EUR 129.90');
    expect(prompt).toContain('129,90 €');
    expect(prompt).toContain('MATCH or MISMATCH');
  });
});

describe('buildArgs', () => {
  it('asks for json, because the text alone carries none of the measurement', () => {
    const args = buildArgs({ prompt: 'q' });
    expect(args.slice(0, 4)).toEqual(['-p', 'q', '--output-format', 'json']);
    expect(args[args.indexOf('--allowed-tools') + 1]).toBe('');
  });

  it('shuts the operator’s own configuration out of every call', () => {
    // Settings, hooks and the skills listing are 25,593 tokens of system prompt
    // on the machine this was written on, rewritten into the cache on every
    // call. Left in, a run costs ten times as much and — the part that matters
    // — measures whichever plugins the person running it happens to have.
    const args = buildArgs({ prompt: 'q' });
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--exclude-dynamic-system-prompt-sections');
    // Not --safe-mode, which does all of the above and also turns off MCP
    // servers passed on the command line, leaving the tools arm with no tools.
    expect(args).not.toContain('--safe-mode');
  });

  it('never passes an mcp config without --strict-mcp-config', () => {
    // Without the flag the CLI also loads whatever MCP servers this machine has
    // configured, and the tools arm gets measured with tools that have nothing
    // to do with the page.
    const args = buildArgs({ prompt: 'q', mcpConfig: '/tmp/page.json', allowedTools: 'mcp__page' });
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/tmp/page.json');
    expect(args[args.indexOf('--allowed-tools') + 1]).toBe('mcp__page');
  });

  it('passes the deny list through, and it covers the two ways out of an arm', () => {
    const args = buildArgs({ prompt: 'q', disallowedTools: BUILT_IN_TOOLS });
    const denied = args[args.indexOf('--disallowed-tools') + 1].split(',');
    // WebFetch would let the text arm answer from the live page; Read would let
    // the tools arm answer from the fixture on disk.
    expect(denied).toContain('WebFetch');
    expect(denied).toContain('Read');
    expect(denied).toContain('Bash');
    // Not an escape route but a turn the client spends fetching schemas for
    // tools it was given the names of. It was a third of the tools arm's turns,
    // on every page, and was measured both ways before being denied.
    expect(denied).toContain('ToolSearch');
  });

  it('passes the model and turn cap when asked, and leaves them out when not', () => {
    expect(buildArgs({ prompt: 'q', model: 'sonnet', maxTurns: 8 })).toContain('--max-turns');
    expect(buildArgs({ prompt: 'q' })).not.toContain('--model');
  });
});

describe('isUsageLimit', () => {
  it('recognises the ways the CLI says the allowance is gone', () => {
    for (const message of [
      'Claude usage limit reached · resets at 3pm',
      '5-hour limit reached',
      'rate_limit_error: too many requests',
      'Rate limit exceeded, please try again later',
    ]) {
      expect(isUsageLimit(message)).toBe(true);
    }
  });

  it('does not read an ordinary failure as one', () => {
    // A page server that will not start is a bug to fix, not a window to wait
    // out, and stopping the whole run for it would hide it.
    expect(isUsageLimit('cannot read fixture: ENOENT')).toBe(false);
    expect(isUsageLimit('Please run /login')).toBe(false);
    expect(isUsageLimit(undefined)).toBe(false);
  });
});

describe('readResult', () => {
  const ok = JSON.stringify({
    result: 'EUR 129.90',
    is_error: false,
    num_turns: 3,
    duration_ms: 4200,
    total_cost_usd: 0.0131,
    usage: {
      input_tokens: 2,
      output_tokens: 18,
      cache_read_input_tokens: 12_025,
      cache_creation_input_tokens: 1464,
    },
    permission_denials: [],
  });

  it('reads the answer and everything the run cost', () => {
    expect(readResult(ok)).toEqual({
      ok: true,
      answer: 'EUR 129.90',
      turns: 3,
      durationMs: 4200,
      costUsd: 0.0131,
      inputTokens: 2,
      outputTokens: 18,
      cachedTokens: 12_025,
      // Almost the whole bill on a run of these, and the field it is easiest to
      // forget: `input_tokens` is 2 because the prompt went into the cache.
      cacheWriteTokens: 1464,
      denials: 0,
    });
  });

  it('treats is_error as a failure even though the CLI exited cleanly', () => {
    // This is how "not logged in" arrives: exit code 0, subtype success,
    // is_error true. Reading the text alone would file "Please run /login" as
    // the agent's answer and score it against the key.
    const result = readResult(
      JSON.stringify({ result: 'Please run /login', is_error: true, num_turns: 0 })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('/login');
    expect(result.answer).toBeUndefined();
  });

  it('counts the denials, which are the record of an arm trying to get out', () => {
    const result = readResult(
      JSON.stringify({ result: 'x', permission_denials: [{ tool_name: 'WebFetch' }] })
    );
    expect(result.denials).toBe(1);
  });

  it('tells a used-up allowance apart from a broken trial', () => {
    // The harness runs on a subscription login, so this is the failure it will
    // actually meet, and the two must not be confused: an ordinary failure is
    // logged and retried later, while this one stops the run. Left running, one
    // exhausted window would burn through every remaining cell in seconds.
    const limited = readResult(
      JSON.stringify({ result: 'Claude usage limit reached · resets at 3pm', is_error: true })
    );
    expect(limited.ok).toBe(false);
    expect(limited.exhausted).toBe(true);

    const broken = readResult(JSON.stringify({ result: 'MCP server failed to start', is_error: true }));
    expect(broken.exhausted).toBe(false);
  });

  it('recognises a refusal that arrives as a status rather than a sentence', () => {
    const limited = readResult(
      JSON.stringify({ result: 'API error', is_error: true, api_error_status: 429 })
    );
    expect(limited.exhausted).toBe(true);
  });

  it('fails loudly on output that is not json at all', () => {
    const result = readResult('command not found: claude');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unparsable');
  });

  it('survives json with none of the fields it wants', () => {
    expect(readResult('{}')).toMatchObject({ ok: true, answer: '', turns: 0, costUsd: 0 });
  });
});
