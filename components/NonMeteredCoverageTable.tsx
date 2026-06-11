'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { format, endOfMonth, startOfMonth, isAfter, parseISO, isValid, differenceInDays } from 'date-fns';
import ConfirmModal from './ConfirmModal';
import InputTypePickerModal from './InputTypePickerModal';
import type {
  NonMeteredRowWithCoverage,
  NonMeteredMonthlyCoverage,
  NonMeteredRecord,
  InputType,
  Category,
} from '@/types';

function coerceMonthDate(monthDate: Date | string): Date {
  if (monthDate instanceof Date) return monthDate;
  const d = parseISO(String(monthDate));
  return isValid(d) ? d : new Date(String(monthDate));
}

/** Stable key for facility-group collapse (Scope 1 non-metered). */
function nonMeteredGroupKey(row: NonMeteredRowWithCoverage): string | null {
  if (!row.groupName) return null;
  if (row.groupId) return row.groupId;
  const sup = row.supplierId ?? '';
  return `${sup}::${row.groupName}`;
}

/** Months strictly after the current calendar month when the line is inactive — show as off, no edits. */
function isInactiveForwardMonth(monthDate: Date | string, lineInactive: boolean): boolean {
  if (!lineInactive) return false;
  const md = coerceMonthDate(monthDate);
  return isAfter(startOfMonth(md), endOfMonth(new Date()));
}

interface NonMeteredCoverageTableProps {
  rows: NonMeteredRowWithCoverage[];
  fiscalYear: number;
  /** Scope for NGERS category dropdown (Scope 1 vs Scope 3 lines). */
  categoryScope?: 1 | 3;
  onCellClick?: (record: NonMeteredRecord) => void;
  onEmptyCellClick?: (row: NonMeteredRowWithCoverage, cell: NonMeteredMonthlyCoverage) => void;
  onLineStatusToggle?: (lineId: string, currentIsActive: boolean) => void;
  onUpdateLine?: (lineId: string, field: 'category_id' | 'input_type_id', value: string | null) => Promise<void>;
  onDeleteLine?: (lineId: string) => Promise<void>;
}

export default function NonMeteredCoverageTable({
  rows,
  fiscalYear,
  categoryScope = 1,
  onCellClick,
  onEmptyCellClick,
  onLineStatusToggle,
  onUpdateLine,
  onDeleteLine,
}: NonMeteredCoverageTableProps) {
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [filterFacility, setFilterFacility] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterGroup, setFilterGroup] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [togglingLineId, setTogglingLineId] = useState<string | null>(null);
  const [deletingRow, setDeletingRow] = useState<NonMeteredRowWithCoverage | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Scope 1 only: collapsed facility group keys (see `nonMeteredGroupKey`). */
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{
    lineId: string;
    field: 'category_id' | 'input_type_id';
    value: string;
  } | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [inputTypes, setInputTypes] = useState<InputType[]>([]);
  const [loadingInputTypes, setLoadingInputTypes] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  const loadCategories = useCallback(async () => {
    if (categories.length > 0 || loadingCategories) return;
    setLoadingCategories(true);
    try {
      const res = await fetch(`/api/categories?scope=${categoryScope}`);
      if (res.ok) {
        const data: Category[] = await res.json();
        setCategories(data);
      }
    } finally {
      setLoadingCategories(false);
    }
  }, [categories.length, loadingCategories, categoryScope]);

  const loadInputTypes = useCallback(async () => {
    if (inputTypes.length > 0 || loadingInputTypes) return;
    setLoadingInputTypes(true);
    try {
      const res = await fetch('/api/input-types');
      if (res.ok) {
        const data: InputType[] = await res.json();
        setInputTypes(data.filter((c) => c.scope === 1));
      }
    } finally {
      setLoadingInputTypes(false);
    }
  }, [inputTypes.length, loadingInputTypes]);

  useEffect(() => {
    setCategories([]);
  }, [categoryScope]);

  useEffect(() => {
    if (editingCell) {
      // Focus the input after it renders
      const timer = setTimeout(() => editInputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [editingCell?.lineId, editingCell?.field]);

  const startEdit = async (lineId: string, field: 'category_id' | 'input_type_id', currentValue: string) => {
    if (!onUpdateLine) return;
    if (field === 'category_id') await loadCategories();
    if (field === 'input_type_id') await loadInputTypes();
    setEditingCell({ lineId, field, value: currentValue });
  };

  const commitEdit = async () => {
    if (!editingCell || !onUpdateLine) return;
    setSavingCell(true);
    try {
      await onUpdateLine(
        editingCell.lineId,
        editingCell.field,
        editingCell.value.trim() || null,
      );
      setEditingCell(null);
    } finally {
      setSavingCell(false);
    }
  };

  const cancelEdit = () => setEditingCell(null);

  const handleInputTypeSelect = async (id: string) => {
    if (!editingCell || !onUpdateLine) return;
    setSavingCell(true);
    try {
      await onUpdateLine(editingCell.lineId, 'input_type_id', id);
      setEditingCell(null);
    } finally {
      setSavingCell(false);
    }
  };

  const handleToggleActive = async (lineId: string, currentIsActive: boolean) => {
    if (!onLineStatusToggle) return;
    setTogglingLineId(lineId);
    try {
      await onLineStatusToggle(lineId, currentIsActive);
    } finally {
      setTogglingLineId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingRow || !onDeleteLine) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await onDeleteLine(deletingRow.lineId);
      setDeletingRow(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete line');
    } finally {
      setDeleteLoading(false);
    }
  };

  const suppliers = Array.from(new Set(rows.map((r) => r.supplierName))).sort();
  const facilityNames = Array.from(new Set(rows.map((r) => r.facilityName))).sort();
  const inputTypeNames = Array.from(new Set(rows.map((r) => r.inputTypeName))).sort();
  const groups = Array.from(new Set(rows.filter((r) => r.groupName).map((r) => r.groupName!))).sort();

  const filteredRows = rows.filter((r) => {
    const s = filterSupplier === 'ALL' || r.supplierName === filterSupplier;
    const f = filterFacility === 'ALL' || r.facilityName === filterFacility;
    const c = filterCategory === 'ALL' || r.inputTypeName === filterCategory;
    const g = filterGroup === 'ALL' || r.groupName === filterGroup;
    const st = filterStatus === 'ALL' ||
      (filterStatus === 'ACTIVE' && r.isActive) ||
      (filterStatus === 'INACTIVE' && !r.isActive);
    return s && f && c && g && st;
  });

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-gray-500">
          No non-metered records found. Upload NGERS data to see coverage.
        </p>
      </div>
    );
  }

  const monthLabels = rows[0]?.coverage.map((c) => c.month) || [];
  const now = new Date();
  const currentMonthLabel = format(now, 'MMM yy');

  return (
    <>
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Filter Controls */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Filters:
          </span>

          {groups.length > 0 && (
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="ALL">All Groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Types</option>
            {inputTypeNames.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={filterFacility}
            onChange={(e) => setFilterFacility(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Facilities</option>
            {facilityNames.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          <span className="text-sm text-gray-500 ml-auto">
            {filteredRows.length}/{rows.length} rows
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="max-h-[600px] overflow-y-auto">
        {/* Header */}
        <div className="border-b border-gray-300 bg-white sticky top-0 z-20 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
          <div className="flex">
            <div className="w-[150px] min-w-[150px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Facility</span>
            </div>
            <div className="w-[130px] min-w-[130px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Supplier</span>
            </div>
            <div className="w-[160px] min-w-[160px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Category</span>
            </div>
            <div className="w-[120px] min-w-[120px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Input Type</span>
            </div>
            <div className="w-[100px] min-w-[100px] px-2 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Status</span>
            </div>
            {onDeleteLine && (
              <div className="w-[44px] min-w-[44px] px-1 py-3 border-r border-gray-300 text-center">
                <span className="sr-only">Actions</span>
              </div>
            )}
            <div className="flex-1 flex">
              {monthLabels.map((month) => {
                const parts = month.split(' ');
                const mon = parts[0]?.toUpperCase() || month;
                const yr = parts[1] || '';
                const isCurrentMonth = month === currentMonthLabel;
                return (
                  <div
                    key={month}
                    className={`flex-1 min-w-[60px] py-2 text-center border-r border-gray-200 last:border-r-0 ${
                      isCurrentMonth ? 'bg-orange-100' : 'bg-white'
                    }`}
                  >
                    <div className={`text-sm font-bold ${isCurrentMonth ? 'text-orange-700' : 'text-gray-700'}`}>
                      {mon}
                    </div>
                    <div className={`text-xs ${isCurrentMonth ? 'text-orange-600' : 'text-gray-500'}`}>
                      {yr}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Body */}
        <div>
          {filteredRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm border-b border-gray-200">
              No rows match your filters.
            </div>
          ) : (
            filteredRows.map((row, rowIdx) => {
              const prevRow = filteredRows[rowIdx - 1];
              const prevKey = prevRow ? nonMeteredGroupKey(prevRow) : null;
              const currKey = nonMeteredGroupKey(row);
              const collapsibleGroups = categoryScope === 1;
              const showGroupHeader =
                Boolean(row.groupName) && currKey !== null && currKey !== prevKey;
              const showUngroupedHeader = !row.groupName && prevRow?.groupName;
              const groupCollapsed =
                collapsibleGroups && currKey !== null && collapsedGroupKeys.has(currKey);
              const skipRowBecauseCollapsed =
                collapsibleGroups &&
                currKey !== null &&
                collapsedGroupKeys.has(currKey) &&
                currKey === prevKey;

              if (skipRowBecauseCollapsed) {
                return null;
              }

              const toggleGroupCollapsed = () => {
                if (!currKey || !collapsibleGroups) return;
                setCollapsedGroupKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(currKey)) next.delete(currKey);
                  else next.add(currKey);
                  return next;
                });
              };

              return (
                <div key={`${row.facilityId}-${row.supplierId}-${row.inputTypeId}`}>
                  {/* Group separator / header */}
                  {showGroupHeader && collapsibleGroups && currKey && (
                    <button
                      type="button"
                      onClick={toggleGroupCollapsed}
                      aria-expanded={!groupCollapsed}
                      className="flex w-full items-center gap-2 px-3 py-1.5 bg-slate-100 border-b border-slate-200 sticky top-[49px] z-10 text-left hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset"
                    >
                      <span className="text-slate-500 shrink-0" aria-hidden>
                        <svg
                          className={`w-4 h-4 transition-transform ${groupCollapsed ? '' : 'rotate-90'}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                        {row.groupName}
                      </span>
                      <span className="text-xs text-slate-400">· {row.supplierName}</span>
                    </button>
                  )}
                  {showGroupHeader && (!collapsibleGroups || !currKey) && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border-b border-slate-200 sticky top-[49px] z-10">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                        {row.groupName}
                      </span>
                      <span className="text-xs text-slate-400">· {row.supplierName}</span>
                    </div>
                  )}
                  {showUngroupedHeader && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200 sticky top-[49px] z-10">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        Other
                      </span>
                    </div>
                  )}

                  {!(groupCollapsed && showGroupHeader) && (
                  <div className="flex border-b border-gray-200 last:border-b-0 hover:bg-gray-50/50">
                    <div className="w-[150px] min-w-[150px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                      <div className="font-semibold text-gray-900 text-sm text-center" title={row.facilityName}>
                        {row.facilityName}
                      </div>
                    </div>
                    <div className="w-[130px] min-w-[130px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                      <div className="text-sm text-gray-700 text-center" title={row.supplierName}>
                        {row.supplierName}
                      </div>
                    </div>
                    {/* Category (sub_category) — inline editable */}
                    <div
                      className={`w-[160px] min-w-[160px] px-3 py-3 border-r border-gray-200 flex items-center justify-center ${onUpdateLine ? 'group/cat' : ''}`}
                    >
                      {editingCell?.lineId === row.lineId && editingCell.field === 'category_id' ? (
                        loadingCategories ? (
                          <span className="text-xs text-gray-400">Loading…</span>
                        ) : (
                          <select
                            ref={editInputRef as React.RefObject<HTMLSelectElement>}
                            value={editingCell.value}
                            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onBlur={commitEdit}
                            disabled={savingCell}
                            className="w-full text-sm border border-emerald-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                          >
                            <option value="">— None —</option>
                            {editingCell.value &&
                              !categories.some((c) => c.id === editingCell.value) && (
                                <option value={editingCell.value}>
                                  {row.categoryName || editingCell.value}
                                </option>
                              )}
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.name}</option>
                            ))}
                          </select>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row.lineId, 'category_id', row.categoryId || '')}
                          disabled={!onUpdateLine}
                          title={onUpdateLine ? 'Click to edit category' : undefined}
                          className={`text-sm text-gray-600 text-center w-full truncate ${onUpdateLine ? 'cursor-pointer rounded px-1 py-0.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors' : 'cursor-default'}`}
                        >
                          {row.categoryName || <span className="text-gray-400">{onUpdateLine ? 'Select category…' : '—'}</span>}
                        </button>
                      )}
                    </div>

                    {/* Input Type (utility_category) — opens picker modal */}
                    <div
                      className={`w-[120px] min-w-[120px] px-3 py-3 border-r border-gray-200 flex items-center justify-center ${onUpdateLine ? 'group/type' : ''}`}
                    >
                      {editingCell?.lineId === row.lineId && editingCell.field === 'input_type_id' && loadingInputTypes ? (
                        <span className="text-xs text-gray-400">Loading…</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row.lineId, 'input_type_id', row.inputTypeId)}
                          disabled={!onUpdateLine || (savingCell && editingCell?.lineId === row.lineId)}
                          title={onUpdateLine ? 'Click to edit input type' : undefined}
                          className={`text-sm text-gray-600 text-center w-full truncate ${onUpdateLine ? 'cursor-pointer rounded px-1 py-0.5 hover:bg-emerald-50 hover:text-emerald-700 transition-colors' : 'cursor-default'}`}
                        >
                          {savingCell && editingCell?.lineId === row.lineId && editingCell.field === 'input_type_id'
                            ? '…'
                            : row.inputTypeName}
                        </button>
                      )}
                    </div>
                    <div className="w-[100px] min-w-[100px] px-2 py-3 border-r border-gray-200 flex items-center justify-center">
                      {onLineStatusToggle ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleActive(row.lineId, row.isActive); }}
                          disabled={togglingLineId === row.lineId}
                          title={row.isActive ? 'Mark as inactive' : 'Mark as active'}
                          className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity ${
                            row.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {togglingLineId === row.lineId ? '…' : row.isActive ? 'Active' : 'Inactive'}
                        </button>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {row.isActive ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </div>
                    {onDeleteLine && (
                      <div className="w-[44px] min-w-[44px] px-1 py-3 border-r border-gray-200 flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeletingRow(row);
                          }}
                          title="Delete line"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Month cells */}
                    <div className="flex-1 flex items-center py-1.5">
                      {row.coverage.map((cell, idx) => {
                        const isCurrentMonth = cell.month === currentMonthLabel;
                        const lineInactive = row.isActive === false;
                        const forwardOff = isInactiveForwardMonth(cell.monthDate, lineInactive);
                        const emptyNoData = cell.status == null && !cell.record;
                        /** Slate "Off" (deactivated), not gray "no data" — inactive line, future months, or any empty month. */
                        const showAsOff = lineInactive && (forwardOff || emptyNoData);
                        const displayCell: NonMeteredMonthlyCoverage = showAsOff
                          ? {
                              month: cell.month,
                              monthDate: coerceMonthDate(cell.monthDate),
                              status: 'DEACTIVATED',
                            }
                          : cell;
                        const clickHandler = showAsOff
                          ? undefined
                          : cell.record
                            ? () => onCellClick?.(cell.record!)
                            : onEmptyCellClick
                              ? () => onEmptyCellClick(row, cell)
                              : undefined;
                        return (
                          <div
                            key={idx}
                            className={`flex-1 min-w-[60px] px-1 ${isCurrentMonth ? 'bg-orange-50/50' : ''}`}
                          >
                            <NonMeteredCell
                              cell={displayCell}
                              onClick={clickHandler}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 bg-gray-100 border-t border-gray-300">
        <div className="flex items-center gap-5 text-sm flex-wrap">
          <span className="font-semibold text-gray-600">Legend:</span>
          <div className="flex items-center gap-2">
            <div className="flex rounded overflow-hidden border border-green-500">
              <div className="w-4 h-5 bg-green-500"></div>
              <div className="w-4 h-5 bg-green-600"></div>
            </div>
            <span className="text-gray-700">Received</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-amber-400 border border-amber-500 rounded"></div>
            <span className="text-gray-700">Pending</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded overflow-hidden border border-red-500">
              <div className="w-4 h-5 bg-red-400"></div>
              <div className="w-4 h-5 bg-red-700"></div>
            </div>
            <span className="text-gray-700">Error</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-slate-500 border border-slate-600 rounded"></div>
            <span className="text-gray-700">Deactivated</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded overflow-hidden border border-slate-400">
              <div className="w-4 h-5 bg-slate-400"></div>
              <div className="w-4 h-5 bg-slate-500"></div>
            </div>
            <span className="text-gray-700">Inferred empty</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-gray-200 border border-gray-300 rounded"></div>
            <span className="text-gray-700">No data</span>
          </div>
          <span className="text-xs text-gray-400 ml-1">Light = recent · Dark = &gt;30 days old</span>
        </div>
      </div>
    </div>

    {editingCell?.field === 'input_type_id' && !loadingInputTypes && inputTypes.length > 0 && (
      <InputTypePickerModal
        inputTypes={inputTypes}
        value={editingCell.value}
        onSelect={handleInputTypeSelect}
        onClose={cancelEdit}
      />
    )}

    {deletingRow && onDeleteLine && (
      <ConfirmModal
        title="Delete Scope 1 Line"
        message={
          <>
            Delete this line and all of its coverage records?
            <span className="block mt-2 font-medium text-gray-900">
              {deletingRow.facilityName} · {deletingRow.supplierName} · {deletingRow.inputTypeName}
            </span>
          </>
        }
        subMessage={
          deletingRow.groupName
            ? `This line is part of the "${deletingRow.groupName}" group and will be removed from that group.`
            : 'This cannot be undone.'
        }
        confirmLabel="Delete line"
        confirmText="delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeletingRow(null);
          setDeleteError(null);
        }}
        loading={deleteLoading}
        error={deleteError ?? undefined}
      />
    )}
    </>
  );
}

function isAgedRecord(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  const d = parseISO(createdAt);
  return isValid(d) && differenceInDays(new Date(), d) > 30;
}

function formatTimestamp(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'd MMM yyyy, h:mm a') : null;
}

// -------------------------------------------------------
// Individual month cell for non-metered grid
// -------------------------------------------------------
interface NonMeteredCellProps {
  cell: NonMeteredMonthlyCoverage;
  onClick?: () => void;
}

function NonMeteredCell({ cell, onClick }: NonMeteredCellProps) {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const aged = isAgedRecord(cell.record?.created_at);

  const getBgColor = () => {
    if (cell.status === 'IMPORTED' || cell.status === 'MANUAL' || cell.status === 'CONFIRMED')
      return aged ? 'bg-green-600 border-green-700' : 'bg-green-500 border-green-600';
    if (cell.status === 'DEACTIVATED')
      return 'bg-slate-500 border-slate-600';
    if (cell.status === 'INFERRED_EMPTY')
      return aged ? 'bg-slate-500 border-slate-600' : 'bg-slate-400 border-slate-500';
    if (cell.status === 'PENDING')
      return 'bg-amber-400 border-amber-500';
    if (cell.status === 'ERROR')
      return aged ? 'bg-red-700 border-red-800' : 'bg-red-400 border-red-500';
    return 'bg-gray-200 border-gray-300';
  };

  const getLabel = () => {
    if (cell.status === 'IMPORTED' || cell.status === 'MANUAL' || cell.status === 'CONFIRMED') return '✓';
    if (cell.status === 'DEACTIVATED') return 'Off';
    if (cell.status === 'INFERRED_EMPTY') return '0';
    if (cell.status === 'PENDING') return '…';
    if (cell.status === 'ERROR') return '!';
    if (!cell.status && onClick) return '+';
    return '—';
  };

  const getTextColor = () => {
    if (!cell.status) return onClick ? 'text-gray-400 group-hover:text-gray-600' : 'text-gray-400';
    return 'text-white';
  };

  const getTooltip = (): { title: string; detail?: string } => {
    const ageSuffix = aged && cell.status !== 'DEACTIVATED' && cell.status !== 'PENDING' ? ' · Uploaded >30 days ago' : '';
    if (cell.status === 'PENDING') {
      const ts = formatTimestamp(cell.record?.created_at);
      return {
        title: 'Invoice received — awaiting confirmation',
        detail: ts ? `Invoice Received: ${ts}` : undefined,
      };
    }
    if (cell.status === 'CONFIRMED') {
      const ts = formatTimestamp(cell.record?.confirmed_at);
      return {
        title: `Confirmed from invoice${ageSuffix}`,
        detail: ts ? `Uploaded: ${ts}` : undefined,
      };
    }
    if (cell.status === 'IMPORTED') return { title: `Invoice received${ageSuffix}` };
    if (cell.status === 'MANUAL') return { title: `Marked as received${ageSuffix}` };
    if (cell.status === 'INFERRED_EMPTY') return { title: `Inferred empty — click to mark as received${ageSuffix}` };
    if (cell.status === 'ERROR') return { title: `Ingestion error — manual fix needed${ageSuffix}` };
    if (cell.status === 'DEACTIVATED') return { title: 'Deactivated — no API data expected' };
    if (onClick) return { title: 'No data — click to mark as received' };
    return { title: 'No data' };
  };

  const handleMouseEnter = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    }
  };

  const content = (
    <div
      className={`h-7 ${getBgColor()} border rounded flex items-center justify-center ${
        onClick ? 'hover:brightness-110 hover:shadow-md transition-all cursor-pointer' : ''
      }`}
    >
      <span className={`text-xs font-bold ${getTextColor()} drop-shadow-sm`}>{getLabel()}</span>
    </div>
  );

  if (!onClick) {
    return (
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
        className="relative"
      >
        {content}
        <CellTooltip pos={tooltipPos} tooltip={getTooltip()} />
      </div>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
        className="focus:outline-none w-full"
      >
        {content}
      </button>
      <CellTooltip pos={tooltipPos} tooltip={getTooltip()} />
    </>
  );
}

function CellTooltip({ pos, tooltip }: { pos: { x: number; y: number } | null; tooltip: { title: string; detail?: string } }) {
  if (!pos) return null;
  return (
    <div
      className="fixed z-[9999] bg-gray-900 text-white text-xs rounded px-3 py-2 shadow-xl pointer-events-none whitespace-nowrap"
      style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
    >
      <div className="font-semibold">{tooltip.title}</div>
      {tooltip.detail && (
        <div className="text-amber-300 text-[11px] mt-0.5">{tooltip.detail}</div>
      )}
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
    </div>
  );
}
