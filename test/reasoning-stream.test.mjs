import assert from 'node:assert/strict';
import test from 'node:test';
import { createReasoningSplitter } from '../lib/reasoning-stream.mjs';

function collect(splitter, chunks) {
  const pieces = [];
  for (const chunk of chunks) for (const piece of splitter.push(chunk)) pieces.push(piece);
  for (const piece of splitter.flush()) pieces.push(piece);
  return pieces;
}

function merge(pieces, type) {
  return pieces.filter((p) => p.type === type).map((p) => p.text).join('');
}

test('splits a single-chunk <think> block from surrounding content', () => {
  const splitter = createReasoningSplitter();
  const pieces = collect(splitter, ['Before. <think>internal monologue</think> After.']);
  assert.equal(merge(pieces, 'content'), 'Before.  After.');
  assert.equal(merge(pieces, 'reasoning'), 'internal monologue');
});

test('handles open and close tags split across chunk boundaries', () => {
  const splitter = createReasoningSplitter();
  const pieces = collect(splitter, ['Hello <thi', 'nk>thinking ', 'hard</th', 'ink> world']);
  assert.equal(merge(pieces, 'content'), 'Hello  world');
  assert.equal(merge(pieces, 'reasoning'), 'thinking hard');
});

test('a reasoning block with no closing tag is flushed as reasoning, not content', () => {
  const splitter = createReasoningSplitter();
  const pieces = collect(splitter, ['<think>cut off mid-thought']);
  assert.equal(merge(pieces, 'content'), '');
  assert.equal(merge(pieces, 'reasoning'), 'cut off mid-thought');
});

test('plain content with no <think> tags at all passes through unchanged', () => {
  const splitter = createReasoningSplitter();
  const pieces = collect(splitter, ['just a normal answer, nothing special']);
  assert.equal(merge(pieces, 'content'), 'just a normal answer, nothing special');
  assert.equal(merge(pieces, 'reasoning'), '');
});

test('multiple think blocks in one stream are all captured as reasoning', () => {
  const splitter = createReasoningSplitter();
  const pieces = collect(splitter, ['<think>first</think>mid<think>second</think>end']);
  assert.equal(merge(pieces, 'content'), 'midend');
  assert.equal(merge(pieces, 'reasoning'), 'firstsecond');
});
