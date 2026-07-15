import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { Me, ReturnAnswers, ReturnQuestion } from "../lib/types";

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
export const useAdminAttention = () => useQuery({ queryKey: ["attention"], queryFn: api.adminAttention });
export const useMyRequests = () => useQuery({ queryKey: ["my-requests"], queryFn: api.myRequests });
export const useUnitByAsset = (assetId: string) =>
  useQuery({ queryKey: ["unit-by-asset", assetId], queryFn: () => api.unitByAsset(assetId), retry: false });
export const useUnitHistory = (unitId: string | null) =>
  useQuery({
    queryKey: ["unit-history", unitId],
    queryFn: () => api.unitHistory(unitId!),
    enabled: unitId !== null,
  });

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
  return useMutation({
    mutationFn: () => api.logout(),
    // qc.clear() would empty the cache without notifying mounted observers,
    // leaving the signed-in UI on screen. Setting ["me"] to null re-renders
    // the app to the auth screen; then drop the user's other cached data.
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });
}

function invalidateBorrowViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["availability"] });
  qc.invalidateQueries({ queryKey: ["my-borrows"] });
  qc.invalidateQueries({ queryKey: ["admin-borrows"] });
  qc.invalidateQueries({ queryKey: ["attention"] });
}

export function useBorrow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { item_type_id: string; days: number; unit_id?: string; with_accessory?: boolean }) =>
      api.borrow(v.item_type_id, v.days, v.unit_id, v.with_accessory),
    onSuccess: () => invalidateBorrowViews(qc),
  });
}
export function useConfirmBorrow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { session_id: string; asset_id: string }) => api.confirmBorrow(v.session_id, v.asset_id),
    onSuccess: () => invalidateBorrowViews(qc),
  });
}
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-requests"] }),
  });
}
export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-requests"] }),
  });
}
export function useAssignAssetIds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.assignAssetIds,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["availability"] }); },
  });
}
export function useReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { session_id: string; asset_id?: string; damaged?: boolean; note?: string; answers?: ReturnAnswers }) =>
      api.returnItem(v),
    onSuccess: () => invalidateBorrowViews(qc),
  });
}
export function useExtend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { session_id: string; days: number }) => api.extendBorrow(v.session_id, v.days),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-borrows"] }),
  });
}
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.mySettings });
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
}
export function useAdminReturn() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (session_id: string) => api.adminReturn(session_id), onSuccess: () => invalidateBorrowViews(qc) });
}
export function useResolveAttention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (session_id: string) => api.resolveAttention(session_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attention"] }),
  });
}
export function useCreateItemType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.createItemType, onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });
}
export function useUpdateItemType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; body: { name?: string; category?: string; notes?: string; return_questions?: ReturnQuestion[]; accessory_type_id?: string | null } }) => api.updateItemType(v.id, v.body), onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }) });
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
export function useAddAccessoryKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: { name?: string; count?: number } }) => api.addAccessoryKit(v.id, v.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); qc.invalidateQueries({ queryKey: ["availability"] }); },
  });
}

export const useMyServiceRequests = () => useQuery({ queryKey: ["my-service"], queryFn: api.myServiceRequests });
export const useAdminServiceRequests = () => useQuery({ queryKey: ["service"], queryFn: api.adminServiceRequests });
export function useRaiseServiceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.raiseServiceRequest,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-service"] }); qc.invalidateQueries({ queryKey: ["service"] }); },
  });
}
export function useResolveServiceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.resolveServiceRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service"] }),
  });
}
export function useSaveDraftAnswers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { session_id: string; answers: ReturnAnswers }) => api.saveDraftAnswers(v.session_id, v.answers),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-borrows"] }),
  });
}
