// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { ForkIcon } from "@/lib/fork-icon";
import { cn } from "@/lib/utils";
import dagre from "@dagrejs/dagre";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  CenterFocusIcon,
  MinusSignIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Background,
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  type XYPosition,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import type { MessageRecord } from "../chat/types";
import {
  CHAT_TREE_PAGE_SIZE,
  projectChatTree,
  recentChatNodes,
} from "./chat-tree-visibility";
import { messageRoleLabel } from "./message-role-label";
import type { ChatTree, ChatTreeNode } from "./normalize-chat-tree";
import "@xyflow/react/dist/style.css";

const NODE_WIDTH = 226;
const NODE_HEIGHT = 64;

type GraphNode = Node<
  {
    item: ChatTreeNode;
    expanded?: boolean;
    selected: boolean;
    toggle: () => void;
    select: (message: MessageRecord) => void;
  },
  "chatTree"
>;

type HistoryEdge = Edge<
  {
    history: string[];
    reveal: (ids: string[]) => void;
  },
  "chatTreeHistory"
>;

function messagePreview(message: MessageRecord): string | undefined {
  const part = message.content.find(
    (part) => part.type === "text" && part.text.trim(),
  );
  return part?.type === "text"
    ? part.text.trim()
    : message.attachments?.[0]?.name;
}

function TreeNode({ data }: NodeProps<GraphNode>) {
  const t = useT();
  const { item, selected, expanded, toggle, select } = data;
  return (
    <div
      className={cn(
        "flex size-full items-center overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        item.kind === "root" && "justify-center gap-2 bg-muted font-semibold",
        selected && "border-ring ring-2 ring-ring/30",
      )}
    >
      {item.kind !== "root" && (
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={false}
          className="pointer-events-none opacity-0"
        />
      )}
      {item.kind === "root" && (
        <>
          <img
            src="/circle-logo-small.png"
            alt="Unsloth"
            className="size-7 rounded-full"
            draggable={false}
          />
          {t("chatTree.allChats")}
        </>
      )}
      {item.kind === "thread" && (
        <button
          type="button"
          className="nodrag flex h-full min-w-0 flex-1 items-center gap-2.5 px-3 text-start focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer enabled:hover:bg-muted/60 disabled:opacity-75"
          onClick={toggle}
          disabled={expanded === undefined}
          aria-expanded={expanded}
          title={item.thread.title}
        >
          <HugeiconsIcon
            icon={item.parentId === "root" ? BubbleChatIcon : ForkIcon}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span
            className="line-clamp-2 min-w-0 flex-1 break-words font-medium text-sm"
            dir="auto"
          >
            {item.thread.title || t("shell.search.untitledChat")}
          </span>
          {expanded !== undefined && (
            <HugeiconsIcon
              icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
        </button>
      )}
      {item.kind === "message" && (
        <>
          <button
            type="button"
            onClick={() => select(item.message)}
            aria-pressed={selected}
            className="nodrag flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center gap-1 px-3 text-start hover:bg-muted/60 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span className="font-medium text-xs text-muted-foreground">
              {messageRoleLabel(item.message.role, t)}
            </span>
            <span className="w-full truncate text-sm leading-snug" dir="auto">
              {messagePreview(item.message) ?? "…"}
            </span>
          </button>
          {expanded !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="nodrag mx-1 shrink-0"
              onClick={toggle}
              aria-expanded={expanded}
              aria-label={t(
                expanded ? "shell.resize.collapse" : "shell.resize.expand",
              )}
            >
              <HugeiconsIcon
                icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
              />
            </Button>
          )}
        </>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="pointer-events-none opacity-0"
      />
    </div>
  );
}

function TreeEdge(props: EdgeProps<HistoryEdge>) {
  const t = useT();
  const [path, x, y] = getSmoothStepPath(props);
  const data = props.data;
  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} />
      {data && data.history.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() =>
                data.reveal(data.history.slice(0, CHAT_TREE_PAGE_SIZE))
              }
            >
              +{CHAT_TREE_PAGE_SIZE}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => data.reveal(data.history)}
            >
              {t("library.tabs.all")}
            </Button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { chatTree: TreeNode };
const edgeTypes = { chatTreeHistory: TreeEdge };

function TreeControls() {
  const t = useT();
  const flow = useReactFlow();
  return (
    <Panel
      position="bottom-left"
      className="flex gap-1 rounded-xl border border-border bg-background p-1 shadow-sm"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          flow.zoomIn({ duration: 150 });
        }}
        aria-label={t("shell.zoom.zoomIn")}
        title={t("shell.zoom.zoomIn")}
      >
        <HugeiconsIcon icon={PlusSignIcon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          flow.zoomOut({ duration: 150 });
        }}
        aria-label={t("shell.zoom.zoomOut")}
        title={t("shell.zoom.zoomOut")}
      >
        <HugeiconsIcon icon={MinusSignIcon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          flow.fitView({ duration: 150, padding: 0.2, maxZoom: 1 });
        }}
        aria-label={t("library.viewer.fit")}
        title={t("library.viewer.fit")}
      >
        <HugeiconsIcon icon={CenterFocusIcon} />
      </Button>
    </Panel>
  );
}

type Projection = ReturnType<typeof projectChatTree>;
type Anchor = { id: string; position: XYPosition };

function layoutTree(
  projection: Projection,
  anchor: Anchor | undefined,
): Map<string, XYPosition> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 60 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const { id } of projection.nodes) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const { source, target } of projection.connections) {
    graph.setEdge(source, target);
  }
  dagre.layout(graph);
  const pinned = anchor && graph.node(anchor.id);
  const offsetX = pinned ? anchor.position.x - pinned.x + NODE_WIDTH / 2 : 0;
  const offsetY = pinned ? anchor.position.y - pinned.y + NODE_HEIGHT / 2 : 0;
  return new Map(
    projection.nodes.map(({ id }) => {
      const { x, y } = graph.node(id);
      return [
        id,
        { x: x + offsetX - NODE_WIDTH / 2, y: y + offsetY - NODE_HEIGHT / 2 },
      ];
    }),
  );
}

function toggleId(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

export function ChatTreeGraph({
  tree,
  selected,
  onSelect,
}: {
  tree: ChatTree;
  selected: MessageRecord | null;
  onSelect: (message: MessageRecord) => void;
}) {
  const t = useT();
  const [initialThreads] = useState(() => recentChatNodes(tree));
  const [openThreads, setOpenThreads] = useState(() => new Set(initialThreads));
  const [collapsedMessages, setCollapsedMessages] = useState(new Set<string>());
  const [revealedMessages, setRevealedMessages] = useState(new Set<string>());
  const [anchor, setAnchor] = useState<Anchor>();
  const projection = useMemo(
    () =>
      projectChatTree(tree, {
        openThreads,
        collapsedMessages,
        revealedMessages,
      }),
    [tree, openThreads, collapsedMessages, revealedMessages],
  );
  const positions = useMemo(
    () => layoutTree(projection, anchor),
    [projection, anchor],
  );
  function rememberAnchor(id: string) {
    const position = positions.get(id);
    if (position) {
      setAnchor({ id, position });
    }
  }
  const nodes: GraphNode[] = projection.nodes.map((item) => ({
    id: item.id,
    type: "chatTree",
    position: positions.get(item.id) ?? { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    // React Flow disables pointer events for nodes with dragging and selection off.
    style: item.kind === "root" ? undefined : { pointerEvents: "auto" },
    data: {
      item,
      selected: item.kind === "message" && selected === item.message,
      expanded: nodeExpansion(
        item,
        tree,
        projection.parents,
        openThreads,
        collapsedMessages,
      ),
      toggle: () => {
        rememberAnchor(item.id);
        if (item.kind === "thread") {
          setOpenThreads((current) => toggleId(current, item.id));
        } else {
          setCollapsedMessages((current) => toggleId(current, item.id));
        }
      },
      select: onSelect,
    },
  }));
  const edges: HistoryEdge[] = projection.connections.map(
    ({ source, target, history, skipped }) => ({
      id: target,
      source,
      target,
      type: "chatTreeHistory",
      style: {
        stroke: "var(--muted-foreground)",
        strokeOpacity: 0.6,
        strokeWidth: 1.4,
        strokeDasharray: skipped ? "4 4" : undefined,
      },
      data: {
        history,
        reveal: (ids) => {
          rememberAnchor(target);
          setRevealedMessages((current) => new Set([...current, ...ids]));
        },
      },
    }),
  );
  const fitTargets =
    nodes.length < 55 && tree.messageNodeIdsByThread.size <= 12
      ? undefined
      : initialThreads.slice(0, 1).map((id) => ({ id }));

  return (
    <ReactFlow<GraphNode, HistoryEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView={true}
      fitViewOptions={{ padding: 0.2, maxZoom: 1, nodes: fitTargets }}
      minZoom={0.12}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
      aria-label={t("chatTree.title")}
      className="bg-muted/35"
    >
      <Background gap={20} size={1} color="var(--border)" />
      <TreeControls />
    </ReactFlow>
  );
}

function nodeExpansion(
  node: ChatTreeNode,
  tree: ChatTree,
  parents: ReadonlySet<string>,
  openThreads: ReadonlySet<string>,
  collapsedMessages: ReadonlySet<string>,
): boolean | undefined {
  if (
    node.kind === "thread" &&
    (tree.messageNodeIdsByThread.get(node.thread.id)?.size ?? 0) > 0
  ) {
    return openThreads.has(node.id);
  }
  if (node.kind === "message" && parents.has(node.id)) {
    return !collapsedMessages.has(node.id);
  }
  return undefined;
}
