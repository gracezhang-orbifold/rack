export type Role = "user" | "admin";
export type UnitStatus = "available" | "in_use" | "needs_repair" | "retired" | "missing";

export interface Me { id: string; email: string; role: Role; full_name: string | null; }

export interface ReminderSettings {
  remind_before_days: number;
  overdue_reminder_every_days: number;
}

export interface AvailabilityItem {
  item_type_id: string; name: string; category: string; notes: string | null;
  total_units: number; available_units: number; in_use_units: number;
  needs_repair_units: number; missing_units: number; asset_ids: string[];
}

export interface ScannedUnit {
  unit_id: string; asset_id: string; status: UnitStatus;
  item_type_id: string; name: string; category: string;
}

export type RequestKind = "waitlist" | "notify" | "reservation";
export interface ItemRequest {
  id: string; item_type_id: string; item_name: string; category: string;
  kind: RequestKind; start_at: string | null; days: number | null;
  created_at: string; position: number | null;
}

export interface ActiveBorrow {
  session_id: string; item_name: string; category: string; asset_id: string | null;
  checked_out_at: string; due_at: string; is_overdue: boolean; unit_confirmed: boolean;
}
export interface HistoryRow {
  session_id: string; item_name: string; asset_id: string | null; status: string;
  checked_out_at: string; returned_at: string | null;
}
export interface MyBorrows { active: ActiveBorrow[]; history: HistoryRow[]; }

export interface BorrowResult {
  session_id: string; item_unit_id: string; due_at: string; unlock: "ok" | "skipped";
}

export interface AdminActiveBorrow {
  session_id: string; user_id: string; email: string; full_name: string | null;
  item_unit_id: string; asset_id: string | null; item_name: string; category: string;
  checked_out_at: string; due_at: string; is_overdue: boolean;
}
export interface AdminHistoryRow {
  session_id: string; email: string; item_name: string; asset_id: string | null; status: string;
  checked_out_at: string; returned_at: string | null;
}

export interface UnitHistoryRow {
  session_id: string; email: string; full_name: string | null; status: string;
  checked_out_at: string; returned_at: string | null;
  return_damaged: boolean | null; return_note: string | null;
}
export interface AdminBorrows { active: AdminActiveBorrow[]; history: AdminHistoryRow[]; }

export interface AdminUnit {
  id: string; asset_id: string | null; status: UnitStatus; owner: string | null; notes: string | null;
  created_at: string;
}
export interface AdminItemType {
  id: string; name: string; category: string; notes: string | null; units: AdminUnit[];
}
