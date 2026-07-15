import { Link } from "react-router-dom";
import { AddItemTypeForm } from "../components/AddItemTypeForm";

// "Add Asset": create a new item type. Units, labels, kits, and return
// questions are managed on the type's card under Total Assets.
export function AdminAddScreen() {
  return (
    <div className="animate-fade-up max-w-md py-3">
      <h2 className="mb-1 text-lg font-semibold">Add asset</h2>
      <p className="mb-4 text-sm text-muted">
        Create a new item type here, then add units, print QR labels, and
        configure kits or return questions under{" "}
        <Link className="text-primary-soft underline" to="/admin/assets">Total Assets</Link>.
      </p>
      <AddItemTypeForm />
    </div>
  );
}
