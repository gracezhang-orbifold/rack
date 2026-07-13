export type Role = "user" | "admin";
export type UnitStatus = "available" | "in_use" | "needs_repair" | "retired" | "missing";

export interface Me { id: string; email: string; role: Role; full_name: string | null; }

export interface AvailabilityItem {
  item_type_id: string; name: string; category: string; notes: string | null;
  total_units: number; available_units: number; in_use_units: number;
  needs_repair_units: number; missing_units: number;
}

export interface ActiveBorrow {
  session_id: string; item_name: string; category: string; asset_id: string | null;
  checked_out_at: string; due_at: string; is_overdue: boolean;
}
export interface HistoryRow {
  session_id: string; item_name: string; status: string;
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
  session_id: string; email: string; item_name: string; status: string;
  checked_out_at: string; returned_at: string | null;
}
export interface AdminBorrows { active: AdminActiveBorrow[]; history: AdminHistoryRow[]; }

export interface AdminUnit {
  id: string; asset_id: string | null; status: UnitStatus; owner: string | null; notes: string | null;
}
export interface AdminItemType {
  id: string; name: string; category: string; notes: string | null; units: AdminUnit[];
}
