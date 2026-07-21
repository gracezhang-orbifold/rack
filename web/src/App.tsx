import { Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./hooks/queries";
import { Spinner, Button } from "./components/ui";
import { Layout } from "./components/Layout";
import { AdminOnly } from "./components/ProtectedRoute";
import { AuthScreen } from "./screens/AuthScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { MyItemsScreen } from "./screens/MyItemsScreen";
import { RequestStatusScreen } from "./screens/RequestStatusScreen";
import { RaiseRequestScreen } from "./screens/RaiseRequestScreen";
import { ServiceRequestScreen } from "./screens/ServiceRequestScreen";
import { AdminDashboardScreen } from "./screens/AdminDashboardScreen";
import { AdminAssignedScreen } from "./screens/AdminAssignedScreen";
import { AdminRequestsScreen } from "./screens/AdminRequestsScreen";
import { AdminAddScreen } from "./screens/AdminAddScreen";
import { AdminServiceScreen } from "./screens/AdminServiceScreen";
import { AdminPeopleScreen } from "./screens/AdminPeopleScreen";
import { AdminApprovalsScreen } from "./screens/AdminApprovalsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { AdminInventoryScreen } from "./screens/AdminInventoryScreen";
import { AdminLabelsScreen } from "./screens/AdminLabelsScreen";
import { ScanScreen } from "./screens/ScanScreen";

export default function App() {
  const me = useMe();

  if (me.isLoading) return <Spinner />;
  if (me.isError) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-lg font-semibold">Can't reach Rack</h1>
        <p className="mb-4 text-sm text-muted">The server isn't responding. Check your connection.</p>
        <Button onClick={() => me.refetch()}>Retry</Button>
      </div>
    );
  }
  if (!me.data) return <AuthScreen />;

  return (
    <Routes>
      <Route element={<Layout me={me.data} />}>
        <Route path="/" element={<BrowseScreen />} />
        <Route path="/my-items" element={<MyItemsScreen />} />
        <Route path="/scan/:assetId" element={<ScanScreen />} />
        <Route path="/requests" element={<RequestStatusScreen />} />
        <Route path="/requests/new" element={<RaiseRequestScreen />} />
        <Route path="/requests/service" element={<ServiceRequestScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/admin" element={<AdminOnly me={me.data}><AdminDashboardScreen /></AdminOnly>} />
        <Route path="/admin/assets" element={<AdminOnly me={me.data}><AdminInventoryScreen /></AdminOnly>} />
        <Route path="/admin/inventory" element={<Navigate to="/admin/assets" replace />} />
        <Route path="/admin/assigned" element={<AdminOnly me={me.data}><AdminAssignedScreen /></AdminOnly>} />
        <Route path="/admin/requests" element={<AdminOnly me={me.data}><AdminRequestsScreen /></AdminOnly>} />
        <Route path="/admin/add" element={<AdminOnly me={me.data}><AdminAddScreen /></AdminOnly>} />
        <Route path="/admin/service" element={<AdminOnly me={me.data}><AdminServiceScreen /></AdminOnly>} />
        <Route path="/admin/people" element={<AdminOnly me={me.data}><AdminPeopleScreen /></AdminOnly>} />
        <Route path="/admin/approvals" element={<AdminOnly me={me.data}><AdminApprovalsScreen /></AdminOnly>} />
        <Route path="/admin/labels" element={<AdminOnly me={me.data}><AdminLabelsScreen /></AdminOnly>} />
      </Route>
    </Routes>
  );
}
