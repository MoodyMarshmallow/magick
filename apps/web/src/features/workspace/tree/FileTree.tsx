import {
  type ItemInstance,
  type Updater,
  hotkeysCoreFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { type DragEvent, type MouseEvent, useMemo } from "react";
import { appIconSize } from "../../../app/appIconSize";
import {
  type FileTreeDirectoryItemData,
  type FileTreeFileItemData,
  createFileTreeAdapter,
} from "./fileTreeAdapter";

interface FileTreeProps {
  readonly tree: readonly LocalWorkspaceTreeNode[];
  readonly activeDocumentId: string | null;
  readonly expandedIds: readonly string[];
  readonly onExpandedIdsChange: (updater: Updater<string[]>) => void;
  readonly onOpenDocument: (documentId: string) => void;
  readonly onStartDragDocument: (documentId: string | null) => void;
}

interface FileTreeNodeProps {
  readonly item: ItemInstance<FileTreeFileItemData | FileTreeDirectoryItemData>;
  readonly activeDocumentId: string | null;
}

const fileTreeIndentStepRem = 0.9;
const fileTreeRowPaddingStartRem = 0.45;
const fileTreeChevronCenterOffsetPx = appIconSize / 2;

function FileTreeDirectoryRow({
  item,
  itemData,
}: {
  readonly item: FileTreeNodeProps["item"];
  readonly itemData: FileTreeDirectoryItemData;
}) {
  return (
    <>
      <span className="file-tree__sigil" aria-hidden="true">
        <span className="file-tree__icon-slot">
          <ChevronRight
            className={`file-tree__chevron${item.isExpanded() ? " is-expanded" : ""}`}
            size={appIconSize}
          />
        </span>
        <span className="file-tree__icon-slot">
          {item.isExpanded() ? (
            <FolderOpen size={appIconSize} />
          ) : (
            <Folder size={appIconSize} />
          )}
        </span>
      </span>
      <span className="file-tree__body">
        <strong>{itemData.name}</strong>
      </span>
    </>
  );
}

function FileTreeFileRow({
  itemData,
}: {
  readonly itemData: FileTreeFileItemData;
}) {
  return (
    <>
      <span className="file-tree__sigil" aria-hidden="true">
        <span className="file-tree__icon-slot" />
        <span className="file-tree__icon-slot">
          <FileText size={appIconSize} />
        </span>
      </span>
      <span className="file-tree__body">
        <strong>{itemData.name}</strong>
      </span>
    </>
  );
}

function FileTreeNode({
  item,
  activeDocumentId,
  onStartDragDocument,
}: FileTreeNodeProps & {
  readonly onStartDragDocument: (documentId: string | null) => void;
}) {
  const itemData = item.getItemData();
  const isFile = itemData.type === "file";
  const isActive = isFile && itemData.documentId === activeDocumentId;
  const itemProps = item.getProps();
  const level = item.getItemMeta().level;
  const guides = Array.from({ length: level }, (_, index) => index);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    itemProps.onClick?.(event);
    if (!event.defaultPrevented) {
      item.primaryAction();
    }
  };

  return (
    <button
      {...itemProps}
      className={`file-tree__row${
        isFile ? " file-tree__row--file" : " file-tree__row--directory"
      }${item.isFocused() ? " is-focused" : ""}${isActive ? " is-active" : ""}`}
      draggable={isFile}
      onDragEnd={() => {
        if (isFile) {
          onStartDragDocument(null);
        }
      }}
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        if (itemData.type === "file") {
          event.dataTransfer.effectAllowed = "copyMove";
          onStartDragDocument(itemData.documentId);
        }
      }}
      onClick={handleClick}
      type="button"
    >
      <span className="file-tree__guides" aria-hidden="true">
        {guides.map((index) => (
          <span
            className="file-tree__guide"
            key={`${item.getId()}-guide-${index}`}
            style={{
              left: `calc(${fileTreeRowPaddingStartRem + index * fileTreeIndentStepRem}rem + ${fileTreeChevronCenterOffsetPx}px)`,
            }}
          />
        ))}
      </span>
      <span
        className="file-tree__row-main"
        key={item.getId()}
        style={{
          paddingLeft: `calc(${fileTreeRowPaddingStartRem}rem + ${level * fileTreeIndentStepRem}rem)`,
        }}
      >
        {itemData.type === "directory" ? (
          <FileTreeDirectoryRow item={item} itemData={itemData} />
        ) : (
          <FileTreeFileRow itemData={itemData} />
        )}
      </span>
    </button>
  );
}

export function FileTree({
  tree: workspaceTree,
  activeDocumentId,
  expandedIds,
  onExpandedIdsChange,
  onOpenDocument,
  onStartDragDocument,
}: FileTreeProps) {
  const adapter = useMemo(
    () => createFileTreeAdapter(workspaceTree),
    [workspaceTree],
  );

  const tree = useTree<FileTreeFileItemData | FileTreeDirectoryItemData>({
    rootItemId: adapter.rootItemId,
    state: {
      expandedItems: expandedIds as string[],
    },
    setExpandedItems: onExpandedIdsChange,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().type === "directory",
    onPrimaryAction: (item) => {
      const itemData = item.getItemData();
      if (itemData.type === "directory") {
        if (item.isExpanded()) {
          item.collapse();
        } else {
          item.expand();
        }
        return;
      }

      onOpenDocument(itemData.documentId);
    },
    dataLoader: {
      getItem: (itemId) => {
        const itemData = adapter.itemById.get(itemId);
        if (!itemData) {
          throw new Error(`File tree item '${itemId}' was not found.`);
        }

        return itemData;
      },
      getChildren: (itemId) => [
        ...(adapter.childrenByParentId.get(itemId) ?? []),
      ],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  return (
    <div {...tree.getContainerProps("Workspace files")} className="file-tree">
      {tree.getItems().map((item) => (
        <FileTreeNode
          activeDocumentId={activeDocumentId}
          item={item}
          key={item.getId()}
          onStartDragDocument={onStartDragDocument}
        />
      ))}
    </div>
  );
}
