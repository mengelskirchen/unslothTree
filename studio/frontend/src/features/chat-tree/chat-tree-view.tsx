// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { AudioPlayer } from "@/components/assistant-ui/audio-player";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { safeMarkdownUrl } from "@/lib/safe-markdown-url";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import type { MessageRecord } from "../chat/types";
import { ChatTreeGraph } from "./chat-tree-graph";
import { loadChatTree } from "./load-chat-tree";
import { messageRoleLabel } from "./message-role-label";
import type { ChatTree } from "./normalize-chat-tree";

const DETAILS_MARKDOWN_CLASS =
  "min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full";

function MessagePart({ part }: { part: MessageRecord["content"][number] }) {
  switch (part.type) {
    case "text":
      return (
        <Streamdown
          mode="static"
          className={DETAILS_MARKDOWN_CLASS}
          urlTransform={safeMarkdownUrl}
        >
          {part.text}
        </Streamdown>
      );
    case "reasoning":
      return (
        <div className="border-s-2 border-border ps-3 text-muted-foreground">
          <Streamdown
            mode="static"
            className={DETAILS_MARKDOWN_CLASS}
            urlTransform={safeMarkdownUrl}
          >
            {part.text}
          </Streamdown>
        </div>
      );
    case "image":
      return part.image.startsWith("data:image/") ? (
        <img
          src={part.image}
          alt={part.filename ?? ""}
          className="max-h-96 max-w-full rounded-lg object-contain"
        />
      ) : (
        <span>{part.filename}</span>
      );
    case "file":
      return (
        <span className="break-all rounded-md border border-border px-2 py-1.5">
          {part.filename ?? part.mimeType}
        </span>
      );
    case "audio": {
      const { audio } = part;
      const mimeType = audio.format === "mp3" ? "audio/mpeg" : "audio/wav";
      return (
        <AudioPlayer
          src={`data:${mimeType};base64,${audio.data}`}
          filename={`audio.${audio.format}`}
        />
      );
    }
    case "source":
      return (
        <Streamdown
          mode="static"
          className={DETAILS_MARKDOWN_CLASS}
          urlTransform={safeMarkdownUrl}
        >
          {part.title ? `${part.title}\n\n${part.url}` : part.url}
        </Streamdown>
      );
    case "tool-call":
      return (
        <details className="min-w-0 rounded-lg border border-border p-3">
          <summary className="cursor-pointer break-all font-medium">
            {part.toolName}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
            {part.argsText || JSON.stringify(part.args, null, 2)}
          </pre>
          {part.result !== undefined && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
              {typeof part.result === "string"
                ? part.result
                : JSON.stringify(part.result, null, 2)}
            </pre>
          )}
        </details>
      );
    default:
      return null;
  }
}

function MessageDetails({
  message,
  tree,
}: { message: MessageRecord | null; tree: ChatTree }) {
  const t = useT();
  if (!message) {
    return (
      <p className="p-5 text-muted-foreground text-sm">
        {t("chatTree.chooseMessage")}
      </p>
    );
  }
  const thread = tree.nodes.get(`thread:${message.threadId}`);
  const createdAt = new Date(message.createdAt);
  return (
    <article className="flex min-w-0 flex-col gap-4 p-5" dir="auto">
      <header className="flex min-w-0 flex-col gap-1 border-border border-b pb-3">
        {thread?.kind === "thread" && (
          <p className="break-words text-muted-foreground text-xs [overflow-wrap:anywhere]">
            {thread.thread.title}
          </p>
        )}
        <h3 className="font-semibold text-base">
          {messageRoleLabel(message.role, t)}
        </h3>
        <time className="text-muted-foreground text-xs">
          {createdAt.toLocaleString()}
        </time>
      </header>
      {message.content.map((part, index) => (
        // Stored content parts are immutable and have no common ID.
        // biome-ignore lint/suspicious/noArrayIndexKey: The article is keyed to the stored message.
        <MessagePart key={index} part={part} />
      ))}
      {message.attachments?.map((attachment) => (
        <div
          key={attachment.id}
          className="break-all rounded-md border border-border px-2 py-1.5"
        >
          {attachment.name}
        </div>
      ))}
    </article>
  );
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; tree: ChatTree };

export function ChatTreeView() {
  const [attempt, setAttempt] = useState(0);
  return (
    <ChatTreeAttempt
      key={attempt}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ChatTreeAttempt({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<MessageRecord | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadChatTree(controller.signal).then(
      (tree) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", tree });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      },
    );
    return () => controller.abort();
  }, []);

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="m-auto flex flex-col items-center gap-3 p-5 text-muted-foreground"
      >
        <p>{t("chatTree.loadError")}</p>
        <Button variant="outline" onClick={onRetry}>
          {t("picker.retry")}
        </Button>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <output className="m-auto p-5 text-muted-foreground">
        {t("common.loading")}
      </output>
    );
  }
  if (state.tree.nodes.size === 1) {
    return (
      <output className="m-auto p-5 text-muted-foreground">
        {t("projectsPage.noChats")}
      </output>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_minmax(16rem,30%)] md:grid-rows-1">
      <div className="min-h-0 min-w-0 overflow-hidden" dir="ltr">
        <ChatTreeGraph
          tree={state.tree}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <aside
        aria-label={t("context.messages")}
        className="max-h-[35dvh] min-h-0 min-w-0 overflow-y-auto border-border border-t bg-background md:max-h-none md:border-s md:border-t-0"
      >
        <MessageDetails
          key={
            selected
              ? JSON.stringify([selected.threadId, selected.id])
              : "empty"
          }
          message={selected}
          tree={state.tree}
        />
      </aside>
    </div>
  );
}
