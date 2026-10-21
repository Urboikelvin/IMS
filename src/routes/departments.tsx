import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RequireRole } from "@/components/RequireRole";
import { DataTable, EmptyRow, Panel, TextInput } from "@/components/inventory-ui";
import { errorMessage, logAudit } from "@/lib/inventory";
import { useDepartments } from "@/hooks/use-session";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/departments")({
  head: () => ({
    meta: [
      { title: `Departments • ${APP_NAME}` },
      { name: "description", content: "Create and rename the departments in your organization." },
    ],
  }),
  component: () => (
    <RequireRole allow={["super_admin"]}>
      <DepartmentsPage />
    </RequireRole>
  ),
});

function friendly(error: unknown, fallback: string) {
  const message = errorMessage(error, fallback);
  if (message.includes("departments_org_name_key")) return "A department with that name already exists.";
  if (message.toLowerCase().includes("foreign key")) {
    return "This department still has items, categories or people assigned to it. Move or remove them first.";
  }
  return message;
}

function DepartmentsPage() {
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["departments"] });
  }

  const create = useMutation({
    mutationFn: async () => {
      const clean = name.trim();
      const { data, error } = await supabase.from("departments").insert({ name: clean }).select("id").single();
      if (error) throw error;
      await logAudit("department.create", "departments", data.id, { name: clean });
    },
    onSuccess: () => {
      toast.success("Department added.");
      setName("");
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not add the department.")),
  });

  const rename = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: string }) => {
      const { error } = await supabase.from("departments").update({ name: next }).eq("id", id);
      if (error) throw error;
      await logAudit("department.rename", "departments", id, { name: next });
    },
    onSuccess: () => {
      toast.success("Department renamed.");
      setEditingId(null);
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not rename the department.")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
      await logAudit("department.delete", "departments", id, null);
    },
    onSuccess: () => {
      toast.success("Department deleted.");
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not delete the department.")),
  });

  function submitNew(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Enter a department name.");
      return;
    }
    create.mutate();
  }

  const list = departments.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Departments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each department keeps its own items, categories and staff. Only you can change this structure.
        </p>
      </header>

      <Panel title="Add department">
        <form onSubmit={submitNew} className="flex gap-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Radiology" />
          <button
            type="submit"
            disabled={create.isPending}
            className="shrink-0 rounded-lg bg-primary px-5 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </Panel>

      <Panel title="All departments" padded={false}>
        <DataTable head={["Name", ""]}>
          {list.length === 0 ? (
            <EmptyRow colSpan={2}>No departments yet.</EmptyRow>
          ) : (
            list.map((dept) => (
              <tr key={dept.id}>
                <td className="px-6 py-3">
                  {editingId === dept.id ? (
                    <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 max-w-xs" autoFocus />
                  ) : (
                    <span className="font-medium">{dept.name}</span>
                  )}
                </td>
                <td className="px-6 py-3 text-right">
                  <div className="flex justify-end gap-3 text-xs font-semibold uppercase">
                    {editingId === dept.id ? (
                      <>
                        <button
                          onClick={() => {
                            if (!editName.trim()) {
                              toast.error("Enter a department name.");
                              return;
                            }
                            rename.mutate({ id: dept.id, next: editName.trim() });
                          }}
                          disabled={rename.isPending}
                          className="text-accent"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(dept.id);
                            setEditName(dept.name);
                          }}
                          className="text-accent"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete ${dept.name}? This only works if nothing is assigned to it.`)) {
                              remove.mutate(dept.id);
                            }
                          }}
                          className="text-destructive"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>
    </div>
  );
}
