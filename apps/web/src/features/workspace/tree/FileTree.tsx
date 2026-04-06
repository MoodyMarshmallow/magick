import {
  type ItemInstance,
  type Updater,
  hotkeysCoreFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import { getLocalWorkspaceFileExtension } from "@magick/shared/localWorkspace";
import {
  ChevronRight,
  EllipsisVertical,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
} from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { appIconSize } from "../../../app/appIconSize";
import {
  OverlayMenu,
  type OverlayMenuPosition,
  getMenuPositionFromPointer,
  getMenuPositionFromTrigger,
} from "../../../app/components/OverlayMenu";
import {
  type FileTreeDirectoryItemData,
  type FileTreeFileItemData,
  createFileTreeAdapter,
} from "./fileTreeAdapter";

interface FileTreeProps {
  readonly tree: readonly LocalWorkspaceTreeNode[];
  readonly activeFilePath: string | null;
  readonly expandedIds: readonly string[];
  readonly onExpandedIdsChange: (updater: Updater<string[]>) => void;
  readonly onOpenFile: (filePath: string) => void;
  readonly onCreateFile: (directoryPath: string) => Promise<void>;
  readonly onCreateDirectory: (directoryPath: string) => Promise<void>;
  readonly onRenameFile: (filePath: string, nextName: string) => Promise<void>;
  readonly onRenameDirectory: (
    directoryPath: string,
    nextName: string,
  ) => Promise<void>;
  readonly onDeleteFile: (filePath: string) => Promise<void>;
  readonly onDeleteDirectory: (directoryPath: string) => Promise<void>;
  readonly onStartDragFile: (filePath: string | null) => void;
}

interface FileTreeNodeProps {
  readonly item: ItemInstance<FileTreeFileItemData | FileTreeDirectoryItemData>;
  readonly activeFilePath: string | null;
  readonly editingItemId: string | null;
  readonly menuState: {
    readonly itemId: string;
    readonly position: OverlayMenuPosition;
  } | null;
  readonly onCreateDirectory: (directoryPath: string) => Promise<void>;
  readonly onCreateFile: (directoryPath: string) => Promise<void>;
  readonly onDeleteDirectory: (directoryPath: string) => Promise<void>;
  readonly onDeleteFile: (filePath: string) => Promise<void>;
  readonly onRenameDirectory: (
    directoryPath: string,
    nextName: string,
  ) => Promise<void>;
  readonly onRenameFile: (filePath: string, nextName: string) => Promise<void>;
  readonly onEditingItemChange: (itemId: string | null, name?: string) => void;
  readonly onMenuStateChange: (
    nextMenuState: {
      readonly itemId: string;
      readonly position: OverlayMenuPosition;
    } | null,
  ) => void;
  readonly renameDraft: string;
}

interface FileTreeRootCreateProps {
  readonly menuState: {
    readonly itemId: string;
    readonly position: OverlayMenuPosition;
  } | null;
  readonly onCreateDirectory: (directoryPath: string) => Promise<void>;
  readonly onCreateFile: (directoryPath: string) => Promise<void>;
  readonly onMenuStateChange: (
    nextMenuState: {
      readonly itemId: string;
      readonly position: OverlayMenuPosition;
    } | null,
  ) => void;
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

function FileTreeRootCreate({
  menuState,
  onCreateDirectory,
  onCreateFile,
  onMenuStateChange,
}: FileTreeRootCreateProps) {
  const isMenuOpen = menuState?.itemId === "__root-create__";

  return (
    <div
      className={`file-tree__root-create${isMenuOpen ? " file-tree__root-create--menu-open" : ""}`}
    >
      <div className="file-tree__root-create-spacer" aria-hidden="true" />
      <div className="file-tree__actions">
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label="More actions for workspace root"
          className="flat-button file-tree__action-button file-tree__action-button--root-create"
          onClick={(event) => {
            event.stopPropagation();
            onMenuStateChange(
              isMenuOpen
                ? null
                : {
                    itemId: "__root-create__",
                    position: getMenuPositionFromPointer({
                      clientX: event.clientX,
                      clientY: event.clientY,
                    }),
                  },
            );
          }}
          type="button"
        >
          <Plus size={appIconSize} />
        </button>
        {isMenuOpen && menuState ? (
          <OverlayMenu
            className="file-tree__menu thread-entry__menu"
            onClose={() => {
              onMenuStateChange(null);
            }}
            position={menuState.position}
          >
            <button
              className="file-tree__menu-item"
              onClick={async (event) => {
                event.stopPropagation();
                onMenuStateChange(null);
                await onCreateFile("");
              }}
              role="menuitem"
              type="button"
            >
              <FilePlus2 size={appIconSize} />
              <span>New file</span>
            </button>
            <button
              className="file-tree__menu-item"
              onClick={async (event) => {
                event.stopPropagation();
                onMenuStateChange(null);
                await onCreateDirectory("");
              }}
              role="menuitem"
              type="button"
            >
              <FolderPlus size={appIconSize} />
              <span>New folder</span>
            </button>
          </OverlayMenu>
        ) : null}
      </div>
    </div>
  );
}

function FileTreeNode({
  item,
  activeFilePath,
  editingItemId,
  menuState,
  onCreateDirectory,
  onCreateFile,
  onDeleteDirectory,
  onDeleteFile,
  onRenameDirectory,
  onRenameFile,
  onEditingItemChange,
  onMenuStateChange,
  renameDraft,
  onStartDragFile,
}: FileTreeNodeProps & {
  readonly onStartDragFile: (filePath: string | null) => void;
}) {
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipNextRenameBlurRef = useRef(false);
  const itemData = item.getItemData();
  const isFile = itemData.type === "file";
  const isActive = isFile && itemData.filePath === activeFilePath;
  const isEditing = editingItemId === item.getId();
  const isMenuOpen = menuState?.itemId === item.getId();
  const itemProps = item.getProps();
  const level = item.getItemMeta().level;
  const guides = Array.from({ length: level }, (_, index) => index);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    itemProps.onClick?.(event);
    if (!event.defaultPrevented) {
      item.primaryAction();
    }
  };

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [isEditing]);

  const cancelRename = () => {
    onEditingItemChange(null);
  };

  const commitRename = async () => {
    const nextName = renameDraft.trim();
    if (!nextName || nextName === itemData.name) {
      cancelRename();
      return;
    }

    if (itemData.type === "file") {
      await onRenameFile(
        itemData.filePath,
        `${nextName}${getLocalWorkspaceFileExtension(itemData.filePath)}`,
      );
    } else {
      await onRenameDirectory(itemData.path, nextName);
    }
    onEditingItemChange(null);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      skipNextRenameBlurRef.current = true;
      cancelRename();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <div
      className={`file-tree__row-shell${isMenuOpen ? " file-tree__row-shell--menu-open" : ""}`}
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
      {isEditing ? (
        <div
          className={`file-tree__row${
            isFile ? " file-tree__row--file" : " file-tree__row--directory"
          }${item.isFocused() ? " is-focused" : ""}${isActive ? " is-active" : ""}`}
        >
          <span
            className="file-tree__row-main"
            key={item.getId()}
            style={{
              paddingLeft: `calc(${fileTreeRowPaddingStartRem}rem + ${level * fileTreeIndentStepRem}rem)`,
            }}
          >
            {itemData.type === "directory" ? (
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
            ) : (
              <span className="file-tree__sigil" aria-hidden="true">
                <span className="file-tree__icon-slot" />
                <span className="file-tree__icon-slot">
                  <FileText size={appIconSize} />
                </span>
              </span>
            )}
            <span className="file-tree__body">
              <input
                aria-label={`Rename ${itemData.name}`}
                className="thread-title-input file-tree__title-input"
                onBlur={() => {
                  if (skipNextRenameBlurRef.current) {
                    skipNextRenameBlurRef.current = false;
                    return;
                  }

                  void commitRename();
                }}
                onChange={(event) => {
                  onEditingItemChange(item.getId(), event.target.value);
                }}
                onKeyDown={handleRenameKeyDown}
                ref={renameInputRef}
                type="text"
                value={renameDraft}
              />
            </span>
          </span>
        </div>
      ) : (
        <button
          {...itemProps}
          className={`file-tree__row${
            isFile ? " file-tree__row--file" : " file-tree__row--directory"
          }${item.isFocused() ? " is-focused" : ""}${isActive ? " is-active" : ""}`}
          draggable={isFile}
          onDragEnd={() => {
            if (isFile) {
              onStartDragFile(null);
            }
          }}
          onDragStart={(event: DragEvent<HTMLButtonElement>) => {
            if (itemData.type === "file") {
              event.dataTransfer.effectAllowed = "copyMove";
              onStartDragFile(itemData.filePath);
            }
          }}
          onClick={handleClick}
          type="button"
        >
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
      )}
      <div className="file-tree__actions">
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={`More actions for ${itemData.name}`}
          className="flat-button file-tree__action-button"
          onClick={(event) => {
            event.stopPropagation();
            onMenuStateChange(
              isMenuOpen
                ? null
                : {
                    itemId: item.getId(),
                    position: getMenuPositionFromTrigger(event.currentTarget),
                  },
            );
          }}
          type="button"
        >
          <EllipsisVertical size={appIconSize} />
        </button>
        {isMenuOpen && menuState ? (
          <OverlayMenu
            className="file-tree__menu thread-entry__menu"
            onClose={() => {
              onMenuStateChange(null);
            }}
            position={menuState.position}
          >
            {itemData.type === "directory" ? (
              <button
                className="file-tree__menu-item"
                onClick={async (event) => {
                  event.stopPropagation();
                  item.expand();
                  onMenuStateChange(null);
                  await onCreateFile(itemData.path);
                }}
                role="menuitem"
                type="button"
              >
                <FilePlus2 size={appIconSize} />
                <span>New file</span>
              </button>
            ) : null}
            {itemData.type === "directory" ? (
              <button
                className="file-tree__menu-item"
                onClick={async (event) => {
                  event.stopPropagation();
                  item.expand();
                  onMenuStateChange(null);
                  await onCreateDirectory(itemData.path);
                }}
                role="menuitem"
                type="button"
              >
                <FolderPlus size={appIconSize} />
                <span>New folder</span>
              </button>
            ) : null}
            <button
              className="file-tree__menu-item"
              onClick={(event) => {
                event.stopPropagation();
                onMenuStateChange(null);
                onEditingItemChange(item.getId(), itemData.name);
              }}
              role="menuitem"
              type="button"
            >
              <span>Rename</span>
            </button>
            <button
              className="file-tree__menu-item"
              onClick={async (event) => {
                event.stopPropagation();
                onMenuStateChange(null);
                if (itemData.type === "file") {
                  await onDeleteFile(itemData.filePath);
                } else {
                  await onDeleteDirectory(itemData.path);
                }
              }}
              role="menuitem"
              type="button"
            >
              <span>Delete</span>
            </button>
          </OverlayMenu>
        ) : null}
      </div>
    </div>
  );
}

export function FileTree({
  tree: workspaceTree,
  activeFilePath,
  expandedIds,
  onExpandedIdsChange,
  onCreateDirectory,
  onCreateFile,
  onDeleteDirectory,
  onDeleteFile,
  onOpenFile,
  onRenameDirectory,
  onRenameFile,
  onStartDragFile,
}: FileTreeProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    readonly itemId: string;
    readonly position: OverlayMenuPosition;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const adapter = useMemo(
    () => createFileTreeAdapter(workspaceTree),
    [workspaceTree],
  );

  useEffect(() => {
    if (editingItemId && !adapter.itemById.has(editingItemId)) {
      setEditingItemId(null);
      setRenameDraft("");
    }

    if (
      menuState &&
      menuState.itemId !== "__root-create__" &&
      !adapter.itemById.has(menuState.itemId)
    ) {
      setMenuState(null);
    }
  }, [adapter.itemById, editingItemId, menuState]);

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

      onOpenFile(itemData.filePath);
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
          activeFilePath={activeFilePath}
          editingItemId={editingItemId}
          item={item}
          key={item.getId()}
          menuState={menuState}
          onCreateDirectory={onCreateDirectory}
          onCreateFile={onCreateFile}
          onDeleteDirectory={onDeleteDirectory}
          onDeleteFile={onDeleteFile}
          onEditingItemChange={(itemId, name) => {
            setEditingItemId(itemId);
            if (typeof name === "string") {
              setRenameDraft(name);
            }
          }}
          onMenuStateChange={setMenuState}
          onRenameDirectory={onRenameDirectory}
          onRenameFile={onRenameFile}
          onStartDragFile={onStartDragFile}
          renameDraft={renameDraft}
        />
      ))}
      <FileTreeRootCreate
        menuState={menuState}
        onCreateDirectory={onCreateDirectory}
        onCreateFile={onCreateFile}
        onMenuStateChange={setMenuState}
      />
    </div>
  );
}
