import { Route, Routes } from "react-router-dom";
import { useMe } from "./hooks/queries";
import { Spinner, Button } from "./components/ui";
import { Layout } from "./components/Layout";
import { AdminOnly } from "./components/ProtectedRoute";
import { AuthScreen } from "./screens/AuthScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { MyItemsScreen } from "./screens/MyItemsScreen";
import { AdminOverviewScreen } from "./screens/AdminOverviewScreen";
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
        <p className="mb-4 text-sm text-gray-600">The server isn't responding. Check your connection.</p>
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
        <Route path="/admin" element={<AdminOnly me={me.data}><AdminOverviewScreen /></AdminOnly>} />
        <Route path="/admin/inventory" element={<AdminOnly me={me.data}><AdminInventoryScreen /></AdminOnly>} />
        <Route path="/admin/labels" element={<AdminOnly me={me.data}><AdminLabelsScreen /></AdminOnly>} />
      </Route>
    </Routes>
  );
}
