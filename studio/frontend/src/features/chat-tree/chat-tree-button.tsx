// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import {
  LazyImportBoundary,
  LazyImportFailure,
} from "@/components/lazy-import-boundary";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AUTH_SESSION_CLEARED_EVENT } from "@/features/auth";
import { useT } from "@/i18n";
import { ForkIcon } from "@/lib/fork-icon";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Suspense, lazy, useEffect, useState } from "react";
import { CHAT_MENU_TRIGGER } from "../chat/components/chat-header-menu";

const ChatTreeView = lazy(() =>
  import("./chat-tree-view").then(({ ChatTreeView }) => ({
    default: ChatTreeView,
  })),
);

export function ChatTreeButton() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, close);
    return () => window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, close);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild={true}>
          <DialogTrigger
            className={CHAT_MENU_TRIGGER}
            aria-label={t("chatTree.title")}
          >
            <HugeiconsIcon
              icon={ForkIcon}
              strokeWidth={1.75}
              className="size-icon"
            />
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="tooltip-compact"
        >
          {t("chatTree.title")}
        </TooltipContent>
      </Tooltip>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="flex h-[calc(100dvh-var(--studio-window-chrome-top,0px)-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-border border-b px-5 py-3">
          <DialogTitle>{t("chatTree.title")}</DialogTitle>
          <DialogClose asChild={true}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.close")}
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          </DialogClose>
        </header>
        {open && (
          <LazyImportBoundary
            fallback={
              <LazyImportFailure
                message={t("chatTree.loadError")}
                reloadLabel={t("settings.dialog.panelReload")}
                testId="chat-tree-load-failure"
                className="m-auto p-5 text-muted-foreground"
              />
            }
          >
            <Suspense
              fallback={
                <output className="m-auto p-5 text-muted-foreground">
                  {t("common.loading")}
                </output>
              }
            >
              <ChatTreeView />
            </Suspense>
          </LazyImportBoundary>
        )}
      </DialogContent>
    </Dialog>
  );
}
