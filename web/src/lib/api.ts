import type {
  Me, AvailabilityItem, MyBorrows, BorrowResult, AdminBorrows, AdminItemType, AdminUnit,
  ScannedUnit, ItemRequest, RequestKind, UnitHistoryRow, ReminderSettings, ServiceRequest, AdminServiceRequest,
  AttentionItem, ReturnAnswers, ReturnQuestion, AdminUser, AllowlistEntry,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    // Fastify rejects an empty body when Content-Type is application/json,
    // so only set it on requests that actually carry one.
    headers: {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

const post = (data?: unknown): RequestInit =>
  ({ method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
const patch = (data: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(data) });

export const api = {
  me: () => request<Me>("/me"),
  login: (email: string, password: string) => request<Me>("/auth/login", post({ email, password })),
  signup: (email: string, password: string, full_name?: string) =>
    request<Me>("/auth/signup", post({ email, password, full_name })),
  logout: () => request<{ ok: true }>("/auth/logout", post()),

  availability: () => request<AvailabilityItem[]>("/availability"),
  myBorrows: () => request<MyBorrows>("/my-borrows"),
  borrow: (item_type_id: string, days: number, unit_id?: string, with_accessory?: boolean, access?: "unlock" | "code") =>
    request<BorrowResult>("/borrow", post({
      item_type_id, days,
      ...(unit_id ? { unit_id } : {}),
      ...(with_accessory ? { with_accessory: true } : {}),
      ...(access === "code" ? { access } : {}),
    })),
  returnItem: (v: { session_id: string; asset_id?: string; damaged?: boolean; note?: string; answers?: ReturnAnswers }) =>
    request<{ session_id: string; status: string; damaged: boolean; flagged: boolean }>("/return", post({
      session_id: v.session_id,
      ...(v.asset_id ? { asset_id: v.asset_id } : {}),
      ...(v.damaged ? { damaged: true, note: v.note } : {}),
      ...(v.answers ? { answers: v.answers } : {}),
    })),
  extendBorrow: (session_id: string, days: number) =>
    request<{ session_id: string; due_at: string }>("/borrow/extend", post({ session_id, days })),
  unlockForBorrow: (session_id: string) =>
    request<{ session_id: string; unlocked: true }>(
      `/borrow/${encodeURIComponent(session_id)}/unlock`, post({})),
  mySettings: () => request<ReminderSettings>("/me/settings"),
  updateSettings: (body: Partial<ReminderSettings>) => request<ReminderSettings>("/me/settings", patch(body)),
  confirmBorrow: (session_id: string, asset_id: string) =>
    request<{ session_id: string; item_unit_id: string; asset_id: string; confirmed: true }>(
      "/borrow/confirm", post({ session_id, asset_id })),
  unitByAsset: (assetId: string) => request<ScannedUnit>(`/units/by-asset/${encodeURIComponent(assetId)}`),

  myRequests: () => request<ItemRequest[]>("/requests"),
  raiseServiceRequest: (body: { asset_id: string; description: string }) =>
    request<ServiceRequest>("/service-requests", post(body)),
  myServiceRequests: () => request<ServiceRequest[]>("/service-requests"),
  saveDraftAnswers: (session_id: string, answers: ReturnAnswers) =>
    request<{ session_id: string; saved: true }>(`/borrow/${encodeURIComponent(session_id)}/draft-answers`,
      { method: "PUT", body: JSON.stringify({ answers }) }),
  createRequest: (body: { item_type_id: string; kind: RequestKind; start_at?: string; days?: number }) =>
    request<ItemRequest>("/requests", post(body)),
  cancelRequest: (id: string) =>
    request<{ id: string; status: string }>(`/requests/${encodeURIComponent(id)}`, { method: "DELETE" }),

  adminBorrows: () => request<AdminBorrows>("/admin/borrows"),
  adminReturn: (session_id: string) => request<{ session_id: string; status: string }>("/admin/return", post({ session_id })),
  adminAttention: () => request<AttentionItem[]>("/admin/attention"),
  adminServiceRequests: () => request<AdminServiceRequest[]>("/admin/service-requests"),
  resolveServiceRequest: (id: string) =>
    request<{ id: string; status: string }>(`/admin/service-requests/${encodeURIComponent(id)}/resolve`, post()),
  resolveAttention: (session_id: string) =>
    request<{ session_id: string; resolved: true }>(`/admin/attention/${encodeURIComponent(session_id)}/resolve`, post()),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: true }>("/auth/change-password", post({ current_password, new_password })),

  adminUsers: () => request<AdminUser[]>("/admin/users"),
  setUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/admin/users/${encodeURIComponent(id)}/password`, post({ password })),
  setUserRole: (id: string, role: "admin" | "user") =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, patch({ role })),
  adminAllowlist: () => request<AllowlistEntry[]>("/admin/allowlist"),
  addAllowlist: (email: string) => request<AllowlistEntry>("/admin/allowlist", post({ email })),
  removeAllowlist: (email: string) =>
    request<{ ok: true }>(`/admin/allowlist/${encodeURIComponent(email)}`, { method: "DELETE" }),
  adminItemTypes: () => request<AdminItemType[]>("/admin/item-types"),
  createItemType: (body: { name: string; category: string; notes?: string; return_questions?: ReturnQuestion[] }) =>
    request<AdminItemType>("/admin/item-types", post(body)),
  updateItemType: (id: string, body: { name?: string; category?: string; notes?: string; return_questions?: ReturnQuestion[]; accessory_type_id?: string | null }) =>
    request<AdminItemType>(`/admin/item-types/${id}`, patch(body)),
  addAccessoryKit: (id: string, body: { name?: string; count?: number }) =>
    request<AdminItemType & { created_units: number }>(`/admin/item-types/${id}/accessory-kit`, post(body)),
  createUnits: (body: { item_type_id: string; count?: number; asset_id?: string; notes?: string }) =>
    request<{ created: number }>("/admin/item-units", post(body)),
  updateUnit: (id: string, body: { status?: string; asset_id?: string; owner?: string; notes?: string }) =>
    request<AdminUnit>(`/admin/item-units/${id}`, patch(body)),
  unitHistory: (id: string) => request<UnitHistoryRow[]>(`/admin/item-units/${encodeURIComponent(id)}/history`),
  assignAssetIds: () => request<{ assigned: number }>("/admin/assign-asset-ids", post()),
};
