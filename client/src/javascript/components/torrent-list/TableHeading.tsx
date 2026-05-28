import classnames from 'classnames';
import {forwardRef, FC, MutableRefObject, ReactNode, useCallback, useRef, useState} from 'react';
import {observer} from 'mobx-react-lite';
import {Trans, useLingui} from '@lingui/react';
import {useEnsuredForwardedRef} from 'react-use';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor as LibMouseSensor,
  TouchSensor as LibTouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {DragMoveEvent, DragStartEvent} from '@dnd-kit/core';
import {restrictToHorizontalAxis} from '@dnd-kit/modifiers';

import {css} from '@client/styled-system/css';
import TorrentListColumns, {TorrentListColumn} from '../../constants/TorrentListColumns';
import SettingActions from '../../actions/SettingActions';
import SettingStore from '../../stores/SettingStore';
import UIStore from '../../stores/UIStore';
import type {ContextMenuItem} from '../../stores/UIStore';

import type {FloodSettings} from '@shared/types/FloodSettings';

const pointerDownStyles = `
  body { user-select: none !important; }
  * { cursor: col-resize !important; }
`;

// Walk up the DOM from a drag's target; bail out of drag activation if any
// ancestor opts out via `data-no-dnd` (the column resize handle does this so a
// resize gesture never starts a reorder drag).
const hasDndDisabled = (target: EventTarget | null): boolean => {
  let node = target as HTMLElement | null;
  while (node != null) {
    if (node.dataset?.noDnd != null) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
};

class MouseSensor extends LibMouseSensor {
  static activators = [
    {
      eventName: 'onMouseDown',
      handler: ({nativeEvent: event}: React.MouseEvent): boolean => event.button !== 2 && !hasDndDisabled(event.target),
    },
  ] as (typeof LibMouseSensor)['activators'];
}

class TouchSensor extends LibTouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart',
      handler: ({nativeEvent: event}: React.TouchEvent): boolean => !hasDndDisabled(event.target),
    },
  ] as (typeof LibTouchSensor)['activators'];
}

interface ColumnHeadingProps {
  id: TorrentListColumn;
  labelID: string;
  width: number;
  isSortActive: boolean;
  sortDirection: FloodSettings['sortTorrents']['direction'];
  handle: ReactNode;
  onClick: (column: TorrentListColumn) => void;
  onFocus: () => void;
}

const ColumnHeading: FC<ColumnHeadingProps> = ({
  id,
  labelID,
  width,
  isSortActive,
  sortDirection,
  handle,
  onClick,
  onFocus,
}: ColumnHeadingProps) => {
  const {i18n} = useLingui();
  const {listeners, setNodeRef: setDragRef, isDragging} = useDraggable({id});
  const {setNodeRef: setDropRef} = useDroppable({id});

  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const classes = classnames('table__cell table__heading', {
    'table__heading--is-sorted': isSortActive,
    [`table__heading--direction--${sortDirection}`]: isSortActive,
    'table__heading--is-dragging': isDragging,
  });

  return (
    <button
      className={`${classes} ${css({
        textAlign: 'left',
        _focus: {
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        },
      })}`}
      ref={setRef}
      role="columnheader"
      aria-sort={isSortActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      type="button"
      onClick={() => onClick(id)}
      onFocus={() => onFocus()}
      style={{
        width: `${width}px`,
      }}
      {...listeners}
    >
      <span className="table__heading__label" title={i18n._(labelID)}>
        <Trans id={labelID} />
      </span>
      {handle}
    </button>
  );
};

interface TableHeadingProps {
  onCellClick: (column: TorrentListColumn) => void;
  onCellFocus: () => void;
  onWidthsChange: (column: TorrentListColumn, width: number) => void;
  onReorder: (columns: FloodSettings['torrentListColumns']) => void;
}

const TableHeading = observer(
  forwardRef<HTMLDivElement, TableHeadingProps>(
    ({onCellClick, onCellFocus, onWidthsChange, onReorder}: TableHeadingProps, ref) => {
      const [isPointerDown, setIsPointerDown] = useState<boolean>(false);
      const [activeColumn, setActiveColumn] = useState<{labelID: string; width: number} | null>(null);

      const focusedCell = useRef<TorrentListColumn>();
      const focusedCellWidth = useRef<number>();
      const lastPointerX = useRef<number>();
      const tableHeading = useEnsuredForwardedRef<HTMLDivElement>(ref as MutableRefObject<HTMLDivElement>);
      const resizeLine = useRef<HTMLDivElement>(null);
      const dropIndicator = useRef<HTMLDivElement>(null);
      const pendingReorder = useRef<FloodSettings['torrentListColumns'] | null>(null);
      // After a drag, the browser fires a click on the column the pointer was
      // released over. Swallow that click so a reorder doesn't also toggle sort.
      const didDrag = useRef<boolean>(false);

      const {i18n} = useLingui();

      const handleContextMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault();

        const {torrentListColumns} = SettingStore.floodSettings;

        // Build full column list: saved order first, then any columns not yet in settings.
        const allColumns: Array<{id: TorrentListColumn; visible: boolean}> = [
          ...torrentListColumns,
          ...Object.keys(TorrentListColumns)
            .filter((key) => torrentListColumns.every((col) => col.id !== key))
            .map((key) => ({id: key as TorrentListColumn, visible: false})),
        ];

        const items: Array<ContextMenuItem> = [
          ...allColumns.map(
            ({id}): ContextMenuItem => ({
              type: 'toggle',
              id,
              label: TorrentListColumns[id],
              checked: () => SettingStore.floodSettings.torrentListColumns.find((c) => c.id === id)?.visible ?? false,
              clickHandler: () => {
                const current = SettingStore.floodSettings.torrentListColumns;
                const updated = current.some((col) => col.id === id)
                  ? current.map((col) => (col.id === id ? {...col, visible: !col.visible} : col))
                  : [...current, {id, visible: true}];
                SettingActions.saveSetting('torrentListColumns', updated as FloodSettings['torrentListColumns']);
              },
            }),
          ),
        ];

        UIStore.setActiveContextMenu({
          id: 'column-list',
          clickPosition: {x: event.clientX, y: event.clientY},
          items,
        });
      }, []);

      const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 10}}),
        useSensor(TouchSensor, {activationConstraint: {distance: 10}}),
      );

      const handlePointerMove = (event: PointerEvent) => {
        let widthDelta = 0;
        if (lastPointerX.current != null) {
          widthDelta = event.clientX - lastPointerX.current;
        }

        let nextCellWidth = 20;
        if (focusedCellWidth.current != null) {
          nextCellWidth = focusedCellWidth.current + widthDelta;
        }

        if (nextCellWidth > 20) {
          focusedCellWidth.current = nextCellWidth;
          lastPointerX.current = event.clientX;
          if (resizeLine.current != null && tableHeading.current != null) {
            resizeLine.current.style.transform = `translate(${Math.max(0, event.clientX)}px, ${
              tableHeading.current.getBoundingClientRect().top
            }px)`;
          }
        }
      };

      const handlePointerUp = () => {
        UIStore.removeGlobalStyle(pointerDownStyles);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointermove', handlePointerMove);

        setIsPointerDown(false);
        lastPointerX.current = undefined;

        if (resizeLine.current != null) {
          resizeLine.current.style.opacity = '0';
        }

        if (focusedCell.current != null && focusedCellWidth.current != null) {
          onWidthsChange(focusedCell.current, focusedCellWidth.current);
        }

        focusedCell.current = undefined;
        focusedCellWidth.current = undefined;
      };

      const hideDropIndicator = () => {
        pendingReorder.current = null;
        if (dropIndicator.current != null) {
          dropIndicator.current.style.opacity = '0';
        }
      };

      const handleDragStart = ({active}: DragStartEvent) => {
        const id = active.id as TorrentListColumn;
        setActiveColumn({
          labelID: TorrentListColumns[id],
          width: SettingStore.floodSettings.torrentListColumnWidths[id] || 100,
        });
      };

      const handleDragMove = ({active, over}: DragMoveEvent) => {
        const draggedRect = active.rect.current.translated;
        if (over == null || draggedRect == null || tableHeading.current == null || over.id === active.id) {
          hideDropIndicator();
          return;
        }

        const draggedCenter = draggedRect.left + draggedRect.width / 2;
        const overCenter = over.rect.left + over.rect.width / 2;
        const insertAfter = draggedCenter > overCenter;

        const fullColumns = SettingStore.floodSettings.torrentListColumns;
        const activeCol = fullColumns.find(({id}) => id === active.id);
        if (activeCol == null) {
          hideDropIndicator();
          return;
        }

        const without = fullColumns.filter(({id}) => id !== active.id);
        const overPos = without.findIndex(({id}) => id === over.id);
        const insertPos = insertAfter ? overPos + 1 : overPos;
        const newColumns = [...without.slice(0, insertPos), activeCol, ...without.slice(insertPos)];

        const changed = newColumns.some((column, index) => column.id !== fullColumns[index].id);
        pendingReorder.current = changed ? newColumns : null;

        const headerRect = tableHeading.current.getBoundingClientRect();
        const boundaryX = insertAfter ? over.rect.right : over.rect.left;
        if (dropIndicator.current != null) {
          dropIndicator.current.style.transform = `translate(${boundaryX}px, ${headerRect.top}px)`;
          dropIndicator.current.style.opacity = changed ? '1' : '0';
        }
      };

      const endDrag = () => {
        didDrag.current = true;
        window.setTimeout(() => {
          didDrag.current = false;
        }, 0);
        setActiveColumn(null);
        hideDropIndicator();
      };

      const handleDragEnd = () => {
        if (pendingReorder.current != null) {
          onReorder(pendingReorder.current);
        }
        endDrag();
      };

      const handleDragCancel = () => {
        endDrag();
      };

      const handleCellClick = (column: TorrentListColumn) => {
        if (didDrag.current) {
          didDrag.current = false;
          return;
        }
        onCellClick(column);
      };

      return (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          autoScroll={false}
        >
          <div
            className="table__row table__row--heading"
            role="row"
            ref={tableHeading}
            onContextMenu={handleContextMenu}
          >
            {SettingStore.floodSettings.torrentListColumns.reduce((accumulator: Array<ReactNode>, {id, visible}) => {
              if (!visible) {
                return accumulator;
              }

              const labelID = TorrentListColumns[id];
              if (labelID == null) {
                return accumulator;
              }

              let handle = null;
              const width = SettingStore.floodSettings.torrentListColumnWidths[id] || 100;

              if (!isPointerDown) {
                handle = (
                  <span
                    className="table__heading__handle"
                    data-no-dnd="true"
                    onPointerDown={(event) => {
                      if (!isPointerDown && resizeLine.current != null && tableHeading.current != null) {
                        setIsPointerDown(true);

                        focusedCell.current = id;
                        focusedCellWidth.current = width;
                        lastPointerX.current = event.clientX;

                        window.addEventListener('pointerup', handlePointerUp);
                        window.addEventListener('pointermove', handlePointerMove);
                        UIStore.addGlobalStyle(pointerDownStyles);

                        resizeLine.current.style.transform = `translate(${Math.max(0, event.clientX)}px, ${
                          tableHeading.current.getBoundingClientRect().top
                        }px)`;
                        resizeLine.current.style.opacity = '1';
                      }
                    }}
                  />
                );
              }

              const isSortActive = id === SettingStore.floodSettings.sortTorrents.property;

              accumulator.push(
                <ColumnHeading
                  key={id}
                  id={id}
                  labelID={labelID}
                  width={width}
                  isSortActive={isSortActive}
                  sortDirection={SettingStore.floodSettings.sortTorrents.direction}
                  handle={handle}
                  onClick={handleCellClick}
                  onFocus={onCellFocus}
                />,
              );

              return accumulator;
            }, [])}
            <div className="table__cell table__heading table__heading--fill" />
            <div className="table__heading__resize-line" ref={resizeLine} />
            <div className="table__heading__drop-indicator" ref={dropIndicator} />
          </div>
          <DragOverlay modifiers={[restrictToHorizontalAxis]} dropAnimation={null}>
            {activeColumn != null ? (
              <div
                className="table__cell table__heading table__heading--drag-overlay"
                style={{width: `${activeColumn.width}px`}}
              >
                <span className="table__heading__label" title={i18n._(activeColumn.labelID)}>
                  <Trans id={activeColumn.labelID} />
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      );
    },
  ),
);

export default TableHeading;
