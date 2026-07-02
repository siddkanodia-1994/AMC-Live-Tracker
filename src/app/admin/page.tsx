import { SettingsForm } from "@/components/admin/settings-form";
import { SyncActions } from "@/components/admin/sync-actions";

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Admin</h1>
      <SettingsForm />
      <SyncActions />
    </div>
  );
}
