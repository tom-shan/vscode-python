// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as uuid from 'uuid/v4';

import { noop } from '../../../../client/common/utils/misc';
import { IEditorContentChange, ILoadAllCells, NotebookModelChange } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { ICell, IDataScienceExtraSettings } from '../../../../client/datascience/types';
import { createCellVM, createEmptyCell, CursorPos, extractInputText, ICellViewModel, IMainState } from '../../../interactive-common/mainState';
import { Helpers } from '../../../interactive-common/redux/reducers/helpers';
import { Transfer } from '../../../interactive-common/redux/reducers/transfer';
import { IAddCellAction, ICellAction } from '../../../interactive-common/redux/reducers/types';
import { actionCreators } from '../actions';
import { NativeEditorReducerArg } from '../mapping';
import { Execution } from './execution';
import { Movement } from './movement';

export namespace Creation {
    function prepareCellVM(cell: ICell, hasBeenRun: boolean, settings?: IDataScienceExtraSettings): ICellViewModel {
        const cellVM: ICellViewModel = createCellVM(cell, settings, true, false);

        // Set initial cell visibility and collapse
        cellVM.editable = true;

        // Always have the cell input text open
        const newText = extractInputText(cellVM, settings);

        cellVM.inputBlockOpen = true;
        cellVM.inputBlockText = newText;
        cellVM.hasBeenRun = hasBeenRun;

        return cellVM;
    }

    function findFirstCodeCellAbove(cellVMs: ICellViewModel[], start: number): string | undefined {
        for (let index = start; index >= 0; index -= 1) {
            if (cellVMs[index].cell.data.cell_type === 'code') {
                return cellVMs[index].cell.id;
            }
        }
    }

    export function insertAbove(arg: NativeEditorReducerArg<ICellAction & IAddCellAction>): IMainState {
        const newVM = prepareCellVM(createEmptyCell(arg.payload.newCellId || uuid(), null), false, arg.prevState.settings);
        const newList = [...arg.prevState.cellVMs];

        // Find the position where we want to insert
        let position = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (position >= 0) {
            newList.splice(position, 0, newVM);
        } else {
            newList.splice(0, 0, newVM);
            position = 0;
        }

        const result = {
            ...arg.prevState,
            undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
            cellVMs: newList
        };

        // Send a messsage that we inserted a cell
        Transfer.postModelInsert(arg, position, newVM.cell, findFirstCodeCellAbove(newList, position));

        // Queue up an action to set focus to the cell we're inserting
        setTimeout(() => {
            arg.queueAction(actionCreators.focusCell(newVM.cell.id));
        });

        return result;
    }

    export function insertBelow(arg: NativeEditorReducerArg<ICellAction & IAddCellAction>): IMainState {
        const newVM = prepareCellVM(createEmptyCell(arg.payload.newCellId || uuid(), null), false, arg.prevState.settings);
        const newList = [...arg.prevState.cellVMs];

        // Find the position where we want to insert
        let position = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (position >= 0) {
            newList.splice(position + 1, 0, newVM);
        } else {
            newList.push(newVM);
            position = newList.length - 2;
        }

        const result = {
            ...arg.prevState,
            undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
            cellVMs: newList
        };

        // Send a messsage that we inserted a cell
        Transfer.postModelInsert(arg, -1, newVM.cell, findFirstCodeCellAbove(newList, position));

        // Queue up an action to set focus to the cell we're inserting
        setTimeout(() => {
            arg.queueAction(actionCreators.focusCell(newVM.cell.id));
        });

        return result;
    }

    export function insertAboveFirst(arg: NativeEditorReducerArg<IAddCellAction>): IMainState {
        // Get the first cell id
        const firstCellId = arg.prevState.cellVMs.length > 0 ? arg.prevState.cellVMs[0].cell.id : undefined;

        // Do what an insertAbove does
        return insertAbove({ ...arg, payload: { cellId: firstCellId, newCellId: arg.payload.newCellId } });
    }

    export function addNewCell(arg: NativeEditorReducerArg<IAddCellAction>): IMainState {
        // Do the same thing that an insertBelow does using the currently selected cell.
        return insertBelow({ ...arg, payload: { cellId: arg.prevState.selectedCellId, newCellId: arg.payload.newCellId } });
    }

    export function startCell(arg: NativeEditorReducerArg<ICell>): IMainState {
        return Helpers.updateOrAdd(arg, (c: ICell, s: IMainState) => prepareCellVM(c, true, s.settings));
    }

    export function updateCell(arg: NativeEditorReducerArg<ICell>): IMainState {
        return Helpers.updateOrAdd(arg, (c: ICell, s: IMainState) => prepareCellVM(c, true, s.settings));
    }

    export function finishCell(arg: NativeEditorReducerArg<ICell>): IMainState {
        return Helpers.updateOrAdd(arg, (c: ICell, s: IMainState) => prepareCellVM(c, true, s.settings));
    }

    export function deleteAllCells(arg: NativeEditorReducerArg<IAddCellAction>): IMainState {
        // Just leave one single blank empty cell
        const newVM: ICellViewModel = {
            cell: createEmptyCell(arg.payload.newCellId, null),
            editable: true,
            inputBlockOpen: true,
            inputBlockShow: true,
            inputBlockText: '',
            inputBlockCollapseNeeded: false,
            selected: false,
            focused: false,
            cursorPos: CursorPos.Current,
            hasBeenRun: false,
            scrollCount: 0
        };

        Transfer.postModelRemoveAll(arg, newVM.cell.id);

        return {
            ...arg.prevState,
            cellVMs: [newVM],
            undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
            selectedCellId: undefined,
            focusedCellId: undefined
        };
    }

    export function applyCellEdit(arg: NativeEditorReducerArg<{ id: string; changes: IEditorContentChange[] }>): IMainState {
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.id);
        if (index) {
            const newVM = { ...arg.prevState.cellVMs[index] };
            arg.payload.changes.forEach(c => {
                const source = newVM.uncommittedText ? newVM.uncommittedText : newVM.inputBlockText;
                const before = source.slice(0, c.rangeOffset);
                const after = source.slice(c.rangeOffset + c.rangeLength);
                newVM.uncommittedText = `${before}${c.text}${after}`;
            });
            newVM.codeVersion = newVM.codeVersion ? newVM.codeVersion + 1 : 1;
            newVM.inputBlockText = newVM.cell.data.source = newVM.uncommittedText!;
            newVM.cursorPos = arg.payload.changes[0].position;
            const newVMs = [...arg.prevState.cellVMs];
            newVMs[index] = Helpers.asCellViewModel(newVM);
            return {
                ...arg.prevState,
                cellVMs: newVMs
            };
        }
        return arg.prevState;
    }

    export function deleteCell(arg: NativeEditorReducerArg<ICellAction>): IMainState {
        const cells = arg.prevState.cellVMs;
        if (cells.length === 1 && cells[0].cell.id === arg.payload.cellId) {
            // Special case, if this is the last cell, don't delete it, just clear it's output and input
            const newVM: ICellViewModel = {
                cell: createEmptyCell(arg.payload.cellId, null),
                editable: true,
                inputBlockOpen: true,
                inputBlockShow: true,
                inputBlockText: '',
                inputBlockCollapseNeeded: false,
                selected: cells[0].selected,
                focused: cells[0].focused,
                cursorPos: CursorPos.Current,
                hasBeenRun: false,
                scrollCount: 0
            };

            // Send messages to other side to indicate the new add
            Transfer.postModelRemove(arg, 0, cells[0].cell);
            Transfer.postModelInsert(arg, 0, newVM.cell);

            return {
                ...arg.prevState,
                undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
                cellVMs: [newVM]
            };
        } else if (arg.payload.cellId) {
            // Otherwise just a straight delete
            const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
            if (index >= 0) {
                Transfer.postModelRemove(arg, 0, cells[index].cell);

                // Recompute select/focus if this item has either
                let newSelection = arg.prevState.selectedCellId;
                let newFocused = arg.prevState.focusedCellId;
                const newVMs = [...arg.prevState.cellVMs.filter(c => c.cell.id !== arg.payload.cellId)];
                const nextOrPrev = index === arg.prevState.cellVMs.length - 1 ? index - 1 : index;
                if (arg.prevState.selectedCellId === arg.payload.cellId || arg.prevState.focusedCellId === arg.payload.cellId) {
                    if (nextOrPrev >= 0) {
                        newVMs[nextOrPrev] = { ...newVMs[nextOrPrev], selected: true, focused: arg.prevState.focusedCellId === arg.payload.cellId };
                        newSelection = newVMs[nextOrPrev].cell.id;
                        newFocused = newVMs[nextOrPrev].focused ? newVMs[nextOrPrev].cell.id : undefined;
                    }
                }

                return {
                    ...arg.prevState,
                    cellVMs: newVMs,
                    selectedCellId: newSelection,
                    focusedCellId: newFocused,
                    undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
                    skipNextScroll: true
                };
            }
        }

        return arg.prevState;
    }

    export function loadAllCells(arg: NativeEditorReducerArg<ILoadAllCells>): IMainState {
        const vms = arg.payload.cells.map(c => prepareCellVM(c, false, arg.prevState.settings));
        return {
            ...arg.prevState,
            busy: false,
            loadTotal: arg.payload.cells.length,
            undoStack: [],
            cellVMs: vms,
            loaded: true
        };
    }

    export function unmount(arg: NativeEditorReducerArg): IMainState {
        return {
            ...arg.prevState,
            cellVMs: [],
            undoStack: [],
            redoStack: []
        };
    }

    function handleUndoModel(arg: NativeEditorReducerArg<NotebookModelChange>): IMainState {
        // Disable the queueAction in the arg so that calling other reducers doesn't cause
        // messages to be posted back (as were handling a message from the extension here)
        const disabledQueueArg = { ...arg, queueAction: noop };
        switch (arg.payload.kind) {
            case 'clear':
                return loadAllCells({ ...disabledQueueArg, payload: { cells: arg.payload.oldCells } });
            case 'edit':
                return applyCellEdit({ ...disabledQueueArg, payload: { id: arg.payload.id, changes: arg.payload.reverse } });
            case 'insert':
                return deleteCell({ ...disabledQueueArg, payload: { cellId: arg.payload.cell.id } });
            case 'remove':
                const cellBelow = arg.prevState.cellVMs.length > arg.payload.index ? arg.prevState.cellVMs[arg.payload.index].cell : undefined;
                return insertAbove({ ...disabledQueueArg, payload: { newCellId: arg.payload.cell.id, cellId: cellBelow ? cellBelow.id : undefined } });
            case 'remove_all':
                return loadAllCells({ ...disabledQueueArg, payload: { cells: arg.payload.oldCells } });
            case 'swap':
                return Movement.swapCells({ ...disabledQueueArg, payload: { firstCellId: arg.payload.secondCellId, secondCellId: arg.payload.firstCellId } });
            default:
                // Modify, file, version can all be ignored.
                break;
        }

        return arg.prevState;
    }

    function handleRedoModel(arg: NativeEditorReducerArg<NotebookModelChange>): IMainState {
        // Disable the queueAction in the arg so that calling other reducers doesn't cause
        // messages to be posted back (as were handling a message from the extension here)
        const disabledQueueArg = { ...arg, queueAction: noop };
        switch (arg.payload.kind) {
            case 'clear':
                return Execution.clearAllOutputs(disabledQueueArg);
            case 'edit':
                return applyCellEdit({ ...disabledQueueArg, payload: { id: arg.payload.id, changes: arg.payload.forward } });
            case 'insert':
                return insertAbove({ ...disabledQueueArg, payload: { newCellId: arg.payload.cell.id, cellId: arg.payload.codeCellAboveId } });
            case 'remove':
                return deleteCell({ ...disabledQueueArg, payload: { cellId: arg.payload.cell.id } });
            case 'remove_all':
                return deleteAllCells({ ...disabledQueueArg, payload: { newCellId: arg.payload.newCellId } });
            case 'swap':
                return Movement.swapCells({ ...disabledQueueArg, payload: { firstCellId: arg.payload.secondCellId, secondCellId: arg.payload.firstCellId } });
            default:
                // Modify, file, version can all be ignored.
                break;
        }

        return arg.prevState;
    }

    export function handleUpdate(arg: NativeEditorReducerArg<NotebookModelChange>): IMainState {
        switch (arg.payload.source) {
            case 'undo':
                return handleUndoModel(arg);
            case 'redo':
                return handleRedoModel(arg);
            default:
                break;
        }
        return arg.prevState;
    }
}
