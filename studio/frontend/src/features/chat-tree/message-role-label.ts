// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { useT } from "@/i18n";
import type { MessageRecord } from "../chat/types";

export function messageRoleLabel(
  role: MessageRecord["role"],
  t: ReturnType<typeof useT>,
): string {
  if (role === "system") {
    return t("context.system");
  }
  return t(role === "assistant" ? "chatTree.assistant" : "chatTree.user");
}
