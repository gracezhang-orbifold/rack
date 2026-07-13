import type {
  Me, AvailabilityItem, MyBorrows, BorrowResult, AdminBorrows, AdminItemType, AdminUnit,
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
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
  borrow: (item_type_id: string, days: number) => request<BorrowResult>("/borrow", post({ item_type_id, days })),
  returnItem: (session_id: string) => request<{ session_id: string; status: string }>("/return", post({ session_id })),

  adminBorrows: () => request<AdminBorrows>("/admin/borrows"),
  adminReturn: (session_id: string) => request<{ session_id: string; status: string }>("/admin/return", post({ session_id })),
  adminItemTypes: () => request<AdminItemType[]>("/admin/item-types"),
  createItemType: (body: { name: string; category: string; notes?: string }) =>
    request<AdminItemType>("/admin/item-types", post(body)),
  updateItemType: (id: string, body: { name?: string; category?: string; notes?: string }) =>
    request<AdminItemType>(`/admin/item-types/${id}`, patch(body)),
  createUnits: (body: { item_type_id: string; count?: number; asset_id?: string; notes?: string }) =>
    request<{ created: number }>("/admin/item-units", post(body)),
  updateUnit: (id: string, body: { status?: string; asset_id?: string; owner?: string; notes?: string }) =>
    request<AdminUnit>(`/admin/item-units/${id}`, patch(body)),
};
