// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { batchListChatMessages, listChatThreads } from "../chat/api/chat-api";
import { type ChatTree, normalizeChatTree } from "./normalize-chat-tree";

export async function loadChatTree(signal?: AbortSignal): Promise<ChatTree> {
  const threads = await listChatThreads({ includeArchived: true, signal });
  const messages = await batchListChatMessages(
    threads.map(({ id }) => id),
    { signal },
  );
  return normalizeChatTree(threads, messages);
}
