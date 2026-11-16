// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { MessageRecord, ThreadRecord } from "../chat/types";
import {
  compareStoredMessages,
  createParentResolver,
  orderParentsFirst,
} from "../chat/utils/message-order.ts";

export type ChatTreeNode =
  | { id: string; kind: "root"; parentId: null }
  | { id: string; kind: "thread"; parentId: string; thread: ThreadRecord }
  | { id: string; kind: "message"; parentId: string; message: MessageRecord };

export interface ChatTree {
  rootId: string;
  nodes: ReadonlyMap<string, ChatTreeNode>;
  /** Maps each stored message ID, including fork copies, to its visible node. */
  messageNodeIdsByThread: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

interface LinkedMessage {
  id: string;
  parentId: string | null;
  record: MessageRecord;
}

type ThreadMessages = Map<string, LinkedMessage>;

function linkMessages(records: readonly MessageRecord[]): ThreadMessages {
  const resolveParent = createParentResolver();
  const linked = [...records].sort(compareStoredMessages).map((record) => ({
    id: record.id,
    parentId: resolveParent(record),
    record,
  }));
  const messages: ThreadMessages = new Map();
  for (const message of orderParentsFirst(linked)) {
    // Missing parents and cycles must still leave the message reachable.
    if (message.parentId !== null && !messages.has(message.parentId)) {
      message.parentId = null;
    }
    messages.set(message.id, message);
  }
  return messages;
}

function pathTo(messages: ThreadMessages, id: string): LinkedMessage[] {
  const path: LinkedMessage[] = [];
  let message = messages.get(id);
  while (message) {
    path.push(message);
    message =
      message.parentId === null ? undefined : messages.get(message.parentId);
  }
  return path.reverse();
}

function sameCopiedPosition(a: LinkedMessage, b: LinkedMessage): boolean {
  return (
    a.record.createdAt === b.record.createdAt && a.record.role === b.record.role
  );
}

function findUniqueCopiedPath(
  sourcePath: readonly LinkedMessage[],
  origin: LinkedMessage,
  messages: ThreadMessages,
  boundaryPath: LinkedMessage[],
): LinkedMessage[] {
  let match: LinkedMessage[] | undefined;
  for (const message of messages.values()) {
    if (!sameCopiedPosition(origin, message)) {
      continue;
    }
    const candidate = pathTo(messages, message.id);
    const matches =
      candidate.length === sourcePath.length &&
      candidate.every((copy, index) => {
        const boundary = boundaryPath[index];
        if (boundary) {
          return copy === boundary;
        }
        const source = sourcePath[index];
        return (
          source !== undefined &&
          sameCopiedPosition(source, copy) &&
          JSON.stringify(source.record.content) ===
            JSON.stringify(copy.record.content)
        );
      });
    if (!matches) {
      continue;
    }
    if (match) {
      return boundaryPath;
    }
    match = candidate;
  }
  return match ?? boundaryPath;
}

function findCopiedPath(
  sourcePath: readonly LinkedMessage[],
  messages: ThreadMessages,
  boundaryId: string | null | undefined,
): LinkedMessage[] {
  const origin = sourcePath.at(-1);
  if (!origin) {
    return [];
  }

  const boundaryPath = boundaryId ? pathTo(messages, boundaryId) : [];
  if (boundaryId) {
    const isCopiedPrefix =
      boundaryPath.length > 0 &&
      boundaryPath.every((copy, index) => {
        const source = sourcePath[index];
        return source !== undefined && sameCopiedPosition(source, copy);
      });
    if (!isCopiedPrefix) {
      return [];
    }
    // After pruning, Studio reseats the divider on the last surviving visible copy.
    const remaining = sourcePath.slice(boundaryPath.length);
    if (
      remaining.length === 0 ||
      remaining.some(({ record }) => record.role !== "system")
    ) {
      return boundaryPath;
    }
  }

  // Older forks lack a divider. A system message can also follow the divider,
  // which Studio places on the last rendered message.
  return findUniqueCopiedPath(sourcePath, origin, messages, boundaryPath);
}

interface ProcessedThread {
  messages: ThreadMessages;
  nodeIds: ReadonlyMap<string, string>;
}

function resolveForkCopies(
  thread: ThreadRecord,
  messages: ThreadMessages,
  processedThreads: ReadonlyMap<string, ProcessedThread>,
): { forkParentId?: string; messageNodeIds: Map<string, string> } {
  const messageNodeIds = new Map<string, string>();
  const source = thread.forkedFromThreadId
    ? processedThreads.get(thread.forkedFromThreadId)
    : undefined;
  let forkParentId: string | undefined;
  if (source && thread.forkedFromMessageId) {
    const sourcePath = pathTo(source.messages, thread.forkedFromMessageId);
    const copies = findCopiedPath(
      sourcePath,
      messages,
      thread.forkBoundaryMessageId,
    );
    for (const [index, copy] of copies.entries()) {
      const original = sourcePath[index];
      const nodeId = original && source.nodeIds.get(original.id);
      if (nodeId) {
        messageNodeIds.set(copy.id, nodeId);
        forkParentId = nodeId;
      }
    }
  }
  return { forkParentId, messageNodeIds };
}

export function normalizeChatTree(
  threads: readonly ThreadRecord[],
  messagesByThread: ReadonlyMap<string, readonly MessageRecord[]>,
): ChatTree {
  const rootId = "root";
  const nodes = new Map<string, ChatTreeNode>([
    [rootId, { id: rootId, kind: "root", parentId: null }],
  ]);
  const messageNodeIdsByThread = new Map<string, Map<string, string>>();
  const processedThreads = new Map<string, ProcessedThread>();
  const orderedThreads = orderParentsFirst(
    threads.map((thread) => ({
      id: thread.id,
      parentId: thread.forkedFromThreadId,
      thread,
    })),
  );

  for (const { thread } of orderedThreads) {
    const threadNodeId = `thread:${thread.id}`;
    const messages = linkMessages(messagesByThread.get(thread.id) ?? []);
    const { forkParentId, messageNodeIds } = resolveForkCopies(
      thread,
      messages,
      processedThreads,
    );

    nodes.set(threadNodeId, {
      id: threadNodeId,
      kind: "thread",
      parentId: forkParentId ?? rootId,
      thread,
    });
    for (const message of messages.values()) {
      if (messageNodeIds.has(message.id)) {
        continue;
      }
      const parentId =
        message.parentId === null
          ? undefined
          : messageNodeIds.get(message.parentId);
      const nodeId = `message:${JSON.stringify([thread.id, message.id])}`;
      nodes.set(nodeId, {
        id: nodeId,
        kind: "message",
        // A continuation at the fork point passes through its own chat node.
        parentId:
          parentId && parentId !== forkParentId ? parentId : threadNodeId,
        message: message.record,
      });
      messageNodeIds.set(message.id, nodeId);
    }
    processedThreads.set(thread.id, { messages, nodeIds: messageNodeIds });
    messageNodeIdsByThread.set(thread.id, messageNodeIds);
  }

  return { rootId, nodes, messageNodeIdsByThread };
}
