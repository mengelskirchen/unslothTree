// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

// biome-ignore lint/correctness/noNodejsModules: This test runs in Node.
import assert from "node:assert/strict";
// biome-ignore lint/correctness/noNodejsModules: This test runs in Node.
import test from "node:test";

import {
  CHAT_TREE_PAGE_SIZE,
  projectChatTree,
  recentChatNodes,
} from "../src/features/chat-tree/chat-tree-visibility.ts";
import { normalizeChatTree } from "../src/features/chat-tree/normalize-chat-tree.ts";
import type {
  MessageRecord,
  ThreadRecord,
} from "../src/features/chat/types.ts";

function get<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${String(key)}`);
  }
  return value;
}

function thread(
  id: string,
  overrides: Partial<ThreadRecord> = {},
): ThreadRecord {
  return {
    id,
    title: id,
    modelType: "base",
    archived: false,
    createdAt: 0,
    ...overrides,
  };
}

function message(
  threadId: string,
  id: string,
  parentId: string | null,
  createdAt: number,
  role: MessageRecord["role"] = "user",
): MessageRecord {
  return {
    id,
    threadId,
    parentId,
    createdAt,
    role,
    content: [{ type: "text", text: `${createdAt}` }],
  };
}

test("joins nested forks, retains each stored ID and preserves alternative replies", () => {
  const source = thread("source");
  const fork = thread("fork", {
    forkedFromThreadId: source.id,
    forkedFromMessageId: "answer",
    forkBoundaryMessageId: "answer-copy",
  });
  const nested = thread("nested", {
    forkedFromThreadId: fork.id,
    forkedFromMessageId: "followup",
    forkBoundaryMessageId: "followup-copy",
  });

  const { nodes, messageNodeIdsByThread } = normalizeChatTree(
    [nested, fork, source],
    new Map([
      [
        "source",
        [
          message("source", "alternative", "question", 2, "assistant"),
          message("source", "answer", "question", 2, "assistant"),
          message("source", "question", null, 1),
        ],
      ],
      [
        "fork",
        [
          message("fork", "followup", "answer-copy", 3),
          message("fork", "answer-copy", "question-copy", 2, "assistant"),
          message("fork", "question-copy", null, 1),
          message("fork", "fork-alternative", "question-copy", 2, "assistant"),
        ],
      ],
      [
        "nested",
        [
          message("nested", "question-copy-2", null, 1),
          message("nested", "answer-copy-2", "question-copy-2", 2, "assistant"),
          message("nested", "followup-copy", "answer-copy-2", 3),
          message("nested", "nested-answer", "followup-copy", 4, "assistant"),
        ],
      ],
    ]),
  );

  const sourceIds = get(messageNodeIdsByThread, "source");
  const forkIds = get(messageNodeIdsByThread, "fork");
  const nestedIds = get(messageNodeIdsByThread, "nested");
  const questionId = get(sourceIds, "question");
  const answerId = get(sourceIds, "answer");
  assert.equal(forkIds.get("question-copy"), questionId);
  assert.equal(forkIds.get("answer-copy"), answerId);
  assert.equal(nestedIds.get("question-copy-2"), questionId);
  assert.equal(nestedIds.get("answer-copy-2"), answerId);
  assert.equal(nestedIds.get("followup-copy"), forkIds.get("followup"));
  assert.equal(nodes.get("thread:fork")?.parentId, answerId);
  assert.equal(nodes.get("thread:nested")?.parentId, forkIds.get("followup"));
  assert.equal(get(nodes, get(forkIds, "followup")).parentId, "thread:fork");
  assert.equal(
    get(nodes, get(nestedIds, "nested-answer")).parentId,
    "thread:nested",
  );
  assert.equal(
    get(nodes, get(forkIds, "fork-alternative")).parentId,
    questionId,
  );
  assert.equal(get(nodes, get(sourceIds, "alternative")).parentId, questionId);
  assert.equal(nodes.size, 10);
});

test("matches an older fork only when the complete copied path is unique", () => {
  const source = thread("source");
  const fork = thread("fork", {
    forkedFromThreadId: "source",
    forkedFromMessageId: "answer",
  });
  const original = [
    message("source", "question", null, 1),
    message("source", "answer", null, 2, "assistant"),
  ];
  const copy = [
    message("fork", "q", null, 1),
    message("fork", "a", "q", 2, "assistant"),
  ];

  const unique = normalizeChatTree(
    [source, fork],
    new Map([
      ["source", original],
      ["fork", copy],
    ]),
  );
  assert.equal(
    unique.nodes.get("thread:fork")?.parentId,
    unique.messageNodeIdsByThread.get("source")?.get("answer"),
  );
  assert.equal(unique.nodes.size, 5);

  const ambiguous = normalizeChatTree(
    [source, fork],
    new Map([
      ["source", original],
      [
        "fork",
        [...copy, message("fork", "another-answer", "q", 2, "assistant")],
      ],
    ]),
  );
  assert.equal(ambiguous.nodes.get("thread:fork")?.parentId, ambiguous.rootId);
  assert.equal(ambiguous.nodes.size, 8);
});

test("joins surviving copies when Studio reseats a fork boundary after pruning", () => {
  const source = thread("source");
  const fork = thread("fork", {
    forkedFromThreadId: "source",
    forkedFromMessageId: "answer",
    forkBoundaryMessageId: "q-copy",
  });
  const { nodes, messageNodeIdsByThread } = normalizeChatTree(
    [source, fork],
    new Map([
      [
        "source",
        [
          message("source", "q", null, 1),
          message("source", "answer", "q", 2, "assistant"),
        ],
      ],
      [
        "fork",
        [
          message("fork", "q-copy", null, 1),
          message("fork", "next", "q-copy", 3),
        ],
      ],
    ]),
  );
  assert.equal(
    nodes.get("thread:fork")?.parentId,
    messageNodeIdsByThread.get("source")?.get("q"),
  );
  assert.equal(
    get(nodes, get(get(messageNodeIdsByThread, "fork"), "next")).parentId,
    "thread:fork",
  );
});

test("uses the actual fork point when a system message follows the visible divider", () => {
  const source = thread("source");
  const fork = thread("fork", {
    forkedFromThreadId: "source",
    forkedFromMessageId: "system",
    forkBoundaryMessageId: "q-copy",
  });
  const { nodes, messageNodeIdsByThread } = normalizeChatTree(
    [source, fork],
    new Map([
      [
        "source",
        [
          message("source", "q", null, 1),
          message("source", "system", "q", 2, "system"),
        ],
      ],
      [
        "fork",
        [
          message("fork", "q-copy", null, 1),
          message("fork", "system-copy", "q-copy", 2, "system"),
        ],
      ],
    ]),
  );
  assert.equal(
    nodes.get("thread:fork")?.parentId,
    messageNodeIdsByThread.get("source")?.get("system"),
  );
  assert.equal(nodes.size, 5);
});

test("keeps a fork's history when the source thread or fork point is missing", () => {
  const missingSource = thread("missing-source", {
    forkedFromThreadId: "deleted",
    forkedFromMessageId: "missing",
  });
  const missingPoint = thread("missing-point", {
    forkedFromThreadId: "empty",
    forkedFromMessageId: "missing",
  });
  const { nodes, rootId } = normalizeChatTree(
    [thread("empty"), missingSource, missingPoint],
    new Map([
      ["missing-source", [message("missing-source", "a", null, 1)]],
      ["missing-point", [message("missing-point", "a", null, 1)]],
    ]),
  );
  assert.equal(nodes.get("thread:missing-source")?.parentId, rootId);
  assert.equal(nodes.get("thread:missing-point")?.parentId, rootId);
  assert.equal(nodes.size, 6);
});

test("every node reaches the shared root even with cyclic or dangling references", () => {
  const a = thread("a", {
    forkedFromThreadId: "b",
    forkedFromMessageId: "first",
  });
  const b = thread("b", {
    forkedFromThreadId: "a",
    forkedFromMessageId: "first",
  });
  const { nodes, rootId } = normalizeChatTree(
    [a, b],
    new Map([
      [
        "a",
        [
          message("a", "first", "second", 1),
          message("a", "second", "first", 2),
          message("a", "orphan", "missing", 3),
        ],
      ],
      ["b", [message("b", "first", null, 1)]],
    ]),
  );
  for (const node of nodes.values()) {
    const seen = new Set<string>();
    let cursor = node;
    while (cursor.parentId !== null) {
      assert.ok(!seen.has(cursor.id));
      seen.add(cursor.id);
      const parent = nodes.get(cursor.parentId);
      assert.ok(parent);
      cursor = parent;
    }
    assert.equal(cursor.id, rootId);
  }
  assert.equal(nodes.size, 7);
});

test("opens five recently active chats and keeps every chat visible", () => {
  const threads = Array.from({ length: 7 }, (_, index) =>
    thread(`chat-${index}`, { updatedAt: index }),
  );
  threads[0] = thread("chat-0", { updatedAt: 0, modifiedAt: 10 });
  const messages = new Map(
    threads.map(({ id }) => [id, [message(id, "first", null, 1)]]),
  );
  const tree = normalizeChatTree(threads, messages);
  const recent = recentChatNodes(tree);
  const projection = projectChatTree(tree, {
    openThreads: new Set(recent),
    collapsedMessages: new Set(),
    revealedMessages: new Set(),
  });
  assert.deepEqual(recent, [
    "thread:chat-0",
    "thread:chat-6",
    "thread:chat-5",
    "thread:chat-4",
    "thread:chat-3",
  ]);
  assert.equal(
    projection.nodes.filter(({ kind }) => kind === "thread").length,
    7,
  );
  assert.equal(
    projection.nodes.filter(({ kind }) => kind === "message").length,
    5,
  );
});

test("shows the latest five messages of each branch and reveals older ancestors on demand", () => {
  const base = Array.from({ length: 12 }, (_, i) =>
    message("chat", `m${i}`, i === 0 ? null : `m${i - 1}`, i),
  );
  const alternative = Array.from({ length: 5 }, (_, i) =>
    message("chat", `a${i}`, i === 0 ? "m9" : `a${i - 1}`, i + 13),
  );
  const tree = normalizeChatTree(
    [thread("chat")],
    new Map([["chat", [...base, ...alternative]]]),
  );
  const visibility = {
    openThreads: new Set(["thread:chat"]),
    collapsedMessages: new Set<string>(),
    revealedMessages: new Set<string>(),
  };
  const ids = get(tree.messageNodeIdsByThread, "chat");
  const initial = projectChatTree(tree, visibility);
  assert.equal(
    initial.nodes.filter(({ kind }) => kind === "message").length,
    10,
  );
  const firstPage = initial.connections.find(
    ({ target }) => target === get(ids, "m7"),
  );
  assert.ok(firstPage);
  assert.deepEqual(
    firstPage.history,
    ["m6", "m5", "m4", "m3", "m2", "m1", "m0"].map((id) => get(ids, id)),
  );
  for (const id of firstPage.history.slice(0, CHAT_TREE_PAGE_SIZE)) {
    visibility.revealedMessages.add(id);
  }
  const second = projectChatTree(tree, visibility);
  const secondPage = second.connections.find(
    ({ target }) => target === get(ids, "m2"),
  );
  assert.ok(secondPage);
  assert.deepEqual(secondPage.history, [get(ids, "m1"), get(ids, "m0")]);
  for (const id of secondPage.history) {
    visibility.revealedMessages.add(id);
  }
  const full = projectChatTree(tree, visibility);
  assert.equal(full.nodes.length, tree.nodes.size);
  assert.ok(full.connections.every(({ skipped }) => !skipped));
});

test("an open fork shows inherited messages from a closed chat and can be collapsed at a shared message", () => {
  const source = thread("source");
  const previous = Array.from({ length: 6 }, (_, index) =>
    message("source", `m${index}`, index === 0 ? null : `m${index - 1}`, index),
  );
  const copies = previous.map((record, index) => ({
    ...record,
    id: `copy-${index}`,
    parentId: index === 0 ? null : `copy-${index - 1}`,
    threadId: "fork",
  }));
  const fork = thread("fork", {
    forkedFromThreadId: "source",
    forkedFromMessageId: "q",
    forkBoundaryMessageId: "q-copy",
  });
  const tree = normalizeChatTree(
    [source, fork],
    new Map([
      [
        "source",
        [
          ...previous,
          message("source", "q", "m5", 6),
          message("source", "a", "q", 7, "assistant"),
        ],
      ],
      [
        "fork",
        [
          ...copies,
          message("fork", "q-copy", "copy-5", 6),
          message("fork", "reply", "q-copy", 8, "assistant"),
        ],
      ],
    ]),
  );
  const visibility = {
    openThreads: new Set(["thread:fork"]),
    collapsedMessages: new Set<string>(),
    revealedMessages: new Set<string>(),
  };
  const sourceIds = get(tree.messageNodeIdsByThread, "source");
  const questionId = get(sourceIds, "q");
  const closed = projectChatTree(tree, visibility);
  assert.deepEqual(
    closed.connections.find(({ target }) => target === "thread:fork"),
    {
      source: questionId,
      target: "thread:fork",
      skipped: false,
      history: [],
    },
  );
  assert.ok(closed.nodes.some(({ id }) => id === questionId));
  assert.ok(closed.nodes.every(({ id }) => id !== get(sourceIds, "a")));
  assert.equal(
    closed.nodes.filter(({ kind }) => kind === "message").length,
    CHAT_TREE_PAGE_SIZE,
  );
  assert.deepEqual(
    closed.connections.find(({ target }) => target === get(sourceIds, "m3"))
      ?.history,
    ["m2", "m1", "m0"].map((id) => get(sourceIds, id)),
  );
  visibility.collapsedMessages.add(questionId);
  const folded = projectChatTree(tree, visibility);
  assert.ok(folded.nodes.some(({ id }) => id === questionId));
  assert.ok(folded.nodes.every(({ id }) => id !== "thread:fork"));
});
