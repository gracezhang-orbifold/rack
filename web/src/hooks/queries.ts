import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { Me } from "../lib/types";

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export const useAvailability = () => useQuery({ queryKey: ["availability"], queryFn: api.availability });
export const useMyBorrows = () => useQuery({ queryKey: ["my-borrows"], queryFn: api.myBorrows });
export const useAdminBorrows = () => useQuery({ queryKey: ["admin-borrows"], queryFn: api.adminBorrows });
export const useAdminInventory = () => useQuery({ queryKey: ["inventory"], queryFn: api.adminItemTypes });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    onSuccess: (me) => { qc.setQueryData(["me"], me); qc.invalidateQueries(); },
  });
}
export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string; full_name?: string }) => api.signup(v.email, v.password, v.full_name),
    onSuccess: (me) => { qc.setQueryData(["me"], me); qc.invalidateQueries(); },
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.logout(), onSuccess: () => qc.clear() });
}

function invalidateBorrowViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["availability"] });
  qc.invalidateQueries({ queryKey: ["my-borrows"] });
  qc.invalidateQueries({ queryKey: ["admin-borrows"] });
}

export function useBorrow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { item_type_id: string; days: number }) => api.borrow(v.item_type_id, v.days),
    onSuccess: () => invalidateBorrowViews(qc),
  });
}
export function useReturn() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (session_id: string) => api.returnItem(session_id), onSuccess: () => invalidateBorrowViews(qc) });
}
export function useAdminReturn() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (session_id: string) => api.adminReturn(session_id), onSuccess: () => invalidateBorrowViews(qc) });
}
export function useCreateItemType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.createItemType, onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });
}
export function useUpdateItemType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; body: { name?: string; category?: string; notes?: string } }) => api.updateItemType(v.id, v.body), onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });
}
export function useCreateUnits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createUnits,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["availability"] }); },
  });
}
export function useUpdateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: { status?: string; asset_id?: string; owner?: string; notes?: string } }) => api.updateUnit(v.id, v.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["availability"] }); },
  });
}
