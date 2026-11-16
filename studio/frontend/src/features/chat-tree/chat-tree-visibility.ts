// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { ChatTree, ChatTreeNode } from "./normalize-chat-tree.ts";

export const CHAT_TREE_PAGE_SIZE = 5;

type TreeThread = Extract<ChatTreeNode, { kind: "thread" }>;

export function recentChatNodes(tree: ChatTree): string[] {
  function lastActivity({ thread }: TreeThread): number {
    return Math.max(
      thread.modifiedAt ?? 0,
      thread.updatedAt ?? thread.createdAt,
    );
  }
  return Array.from(tree.nodes.values())
    .filter((node) => node.kind === "thread")
    .sort((a, b) => lastActivity(b) - lastActivity(a))
    .slice(0, CHAT_TREE_PAGE_SIZE)
    .map(({ id }) => id);
}

interface Visibility {
  openThreads: ReadonlySet<string>;
  collapsedMessages: ReadonlySet<string>;
  revealedMessages: ReadonlySet<string>;
}

function ownerThreadId(node: ChatTreeNode | undefined): string | undefined {
  if (node?.kind === "message") {
    return node.message.threadId;
  }
  return node?.kind === "thread" ? node.thread.id : undefined;
}

function isInOpenThread(
  node: ChatTreeNode,
  openThreads: ReadonlySet<string>,
): boolean {
  const owner = ownerThreadId(node);
  return owner !== undefined && openThreads.has(`thread:${owner}`);
}

function indexTree(tree: ChatTree, collapsedMessages: ReadonlySet<string>) {
  const blocked = new Set<string>();
  const parents = new Set<string>();
  const hasContinuation = new Set<string>();
  for (const node of tree.nodes.values()) {
    if (node.parentId === null) {
      continue;
    }
    parents.add(node.parentId);
    if (blocked.has(node.parentId) || collapsedMessages.has(node.parentId)) {
      blocked.add(node.id);
      continue;
    }
    const parentThread = ownerThreadId(tree.nodes.get(node.parentId));
    if (node.kind === "message" && parentThread === node.message.threadId) {
      hasContinuation.add(node.parentId);
    }
  }
  return { blocked, parents, hasContinuation };
}

function collapsedOpenBranches(
  nodesFromLeaves: readonly ChatTreeNode[],
  visibility: Visibility,
): Set<string> {
  if (visibility.collapsedMessages.size === 0) {
    return new Set();
  }
  const hasOpenDescendant = new Set<string>();
  for (const node of nodesFromLeaves) {
    if (
      node.parentId !== null &&
      (hasOpenDescendant.has(node.id) ||
        isInOpenThread(node, visibility.openThreads))
    ) {
      hasOpenDescendant.add(node.parentId);
    }
  }
  // An inherited message can be the visible folding point of an open fork even
  // while its own chat is closed.
  return new Set(
    Array.from(visibility.collapsedMessages).filter((id) =>
      hasOpenDescendant.has(id),
    ),
  );
}

function branchHistory(
  tree: ChatTree,
  { blocked, hasContinuation }: ReturnType<typeof indexTree>,
  visibility: Visibility,
) {
  const fromLeaves = Array.from(tree.nodes.values()).reverse();
  const folded = collapsedOpenBranches(fromLeaves, visibility);
  const budgetByNode = new Map<string, number>();
  const historyNodes = new Set<string>();
  const latest = new Set<string>();
  // Propagate from each open branch's leaf through the fork marker into shared
  // history. A budget of zero keeps older messages available for pagination.
  for (const node of fromLeaves) {
    if (node.parentId === null || blocked.has(node.id)) {
      continue;
    }
    const isOpenLeaf =
      isInOpenThread(node, visibility.openThreads) &&
      !hasContinuation.has(node.id);
    const startsHistory = isOpenLeaf || folded.has(node.id);
    const budget = startsHistory
      ? CHAT_TREE_PAGE_SIZE
      : budgetByNode.get(node.id);
    if (budget === undefined) {
      continue;
    }
    historyNodes.add(node.id);
    if (node.kind === "message" && budget > 0) {
      latest.add(node.id);
    }
    const remaining = budget - Number(node.kind === "message");
    budgetByNode.set(
      node.parentId,
      Math.max(budgetByNode.get(node.parentId) ?? 0, remaining),
    );
  }
  return { historyNodes, latest };
}

export interface ChatTreeConnection {
  source: string;
  target: string;
  skipped: boolean;
  /** Closest hidden ancestors first. */
  history: string[];
}

export function projectChatTree(tree: ChatTree, visibility: Visibility) {
  const index = indexTree(tree, visibility.collapsedMessages);
  const { blocked, parents } = index;
  const { historyNodes, latest } = branchHistory(tree, index, visibility);
  const nodes = Array.from(tree.nodes.values()).filter(
    (node) =>
      !blocked.has(node.id) &&
      (node.kind !== "message" ||
        latest.has(node.id) ||
        (historyNodes.has(node.id) &&
          visibility.revealedMessages.has(node.id))),
  );
  const visible = new Set(nodes.map(({ id }) => id));
  const connections: ChatTreeConnection[] = [];

  for (const node of nodes) {
    if (node.parentId === null) {
      continue;
    }
    const history: string[] = [];
    let ancestor = tree.nodes.get(node.parentId);
    while (ancestor?.parentId != null && !visible.has(ancestor.id)) {
      if (historyNodes.has(ancestor.id)) {
        history.push(ancestor.id);
      }
      ancestor = tree.nodes.get(ancestor.parentId);
    }
    if (ancestor) {
      connections.push({
        source: ancestor.id,
        target: node.id,
        skipped: ancestor.id !== node.parentId,
        history,
      });
    }
  }
  return { nodes, connections, parents };
}
