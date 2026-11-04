import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createOrganizationFn } from "@/integrations/supabase/user-admin";
import { errorMessage, fetchAllRows } from "@/lib/inventory";
import {
  attentionItems,
  fleetSummary,
  paymentsByOrg,
  formatNaira,
  type BillingRow,
  type EventRow,
  type OrgRow,
  type OverviewRow,
  type PaymentRow,
} from "@/lib/platform";

export type ClientDetails = {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  subscriptionEndsOn: string;
  planName: string;
  monthlyFee: number;
  billingNotes: string;
};

export type NewClientInput = ClientDetails & {
  adminName: string;
  adminEmail: string;
  adminPassword: string;
};

export type PaymentInput = {
  orgId: string;
  amount: number;
  paidOn: string;
  months: number;
  reference: string;
  note: string;
  extend: boolean;
};

function friendly(error: unknown, fallback: string) {
  const message = errorMessage(error, fallback);
  return message.includes("organizations_name_lower_key") ? "A client with that name already exists." : message;
}

export function usePlatformData() {
  const queryClient = useQueryClient();

  const orgs = useQuery({
    queryKey: ["platform-orgs"],
    queryFn: () =>
      fetchAllRows<OrgRow>((from, to) =>
        supabase
          .from("organizations")
          .select("id, name, status, contact_name, contact_email, contact_phone, subscription_ends_on, created_at")
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to),
      ),
  });

  // Counts and activity only — never any client's stock contents.
  const overview = useQuery({
    queryKey: ["platform-overview"],
    queryFn: async (): Promise<OverviewRow[]> => {
      const { data, error } = await supabase.rpc("platform_org_overview");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Money tables. If the billing migration hasn't been applied yet these fail,
  // and the page falls back to the client list with a notice (see billingReady).
  const billing = useQuery({
    queryKey: ["platform-billing"],
    retry: false,
    queryFn: () =>
      fetchAllRows<BillingRow>((from, to) =>
        supabase
          .from("organization_billing")
          .select("organization_id, plan_name, monthly_fee, billing_notes")
          .order("organization_id")
          .range(from, to),
      ),
  });

  const payments = useQuery({
    queryKey: ["platform-payments"],
    retry: false,
    queryFn: () =>
      fetchAllRows<PaymentRow>((from, to) =>
        supabase
          .from("client_payments")
          .select("id, organization_id, amount, paid_on, months_covered, extended, reference, note, created_at")
          .order("paid_on", { ascending: false })
          .order("id")
          .range(from, to),
      ),
  });

  const events = useQuery({
    queryKey: ["platform-events"],
    retry: false,
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase
        .from("platform_events")
        .select("id, organization_id, organization_name, kind, details, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  const billingReady = !billing.isError && !payments.isError;

  const derived = useMemo(() => {
    const orgList = orgs.data ?? [];
    const billingByOrg = new Map((billing.data ?? []).map((row) => [row.organization_id, row]));
    const overviewByOrg = new Map((overview.data ?? []).map((row) => [row.org_id, row]));
    const paymentList = payments.data ?? [];
    return {
      orgList,
      billingByOrg,
      overviewByOrg,
      paymentsByOrg: paymentsByOrg(paymentList),
      summary: fleetSummary(orgList, overviewByOrg),
      attention: attentionItems(orgList, billingByOrg, overviewByOrg),
    };
  }, [orgs.data, billing.data, overview.data, payments.data]);

  function refresh() {
    for (const key of ["orgs", "overview", "billing", "payments", "events"]) {
      queryClient.invalidateQueries({ queryKey: [`platform-${key}`] });
    }
  }

  async function saveBilling(orgId: string, details: Pick<ClientDetails, "planName" | "monthlyFee" | "billingNotes">) {
    const { error } = await supabase.from("organization_billing").upsert(
      {
        organization_id: orgId,
        plan_name: details.planName.trim() || null,
        monthly_fee: details.monthlyFee,
        billing_notes: details.billingNotes.trim() || null,
      },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
  }

  const createClient = useMutation({
    mutationFn: async (input: NewClientInput) => {
      const created = await createOrganizationFn({
        data: {
          name: input.name,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          subscriptionEndsOn: input.subscriptionEndsOn,
          adminName: input.adminName,
          adminEmail: input.adminEmail,
          adminPassword: input.adminPassword,
        },
      });
      // The client exists now; a billing hiccup must not look like a failed signup.
      let billingSaved = true;
      try {
        await saveBilling(created.id, input);
      } catch {
        billingSaved = false;
      }
      return { ...created, billingSaved };
    },
    onSuccess: (result) => {
      toast.success(`${result.name} is set up. Share the sign-in details with ${result.adminEmail}.`);
      if (!result.billingSaved) toast.warning("The plan and fee were not saved. Open the client and set them under Details.");
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not create the client.")),
  });

  const saveClient = useMutation({
    mutationFn: async ({ orgId, details }: { orgId: string; details: ClientDetails }) => {
      const { error } = await supabase
        .from("organizations")
        .update({
          name: details.name.trim(),
          contact_name: details.contactName.trim() || null,
          contact_email: details.contactEmail.trim() || null,
          contact_phone: details.contactPhone.trim() || null,
          subscription_ends_on: details.subscriptionEndsOn || null,
        })
        .eq("id", orgId);
      if (error) throw error;
      if (billingReady) await saveBilling(orgId, details);
    },
    onSuccess: () => {
      toast.success("Client updated.");
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not save changes.")),
  });

  const setStatus = useMutation({
    mutationFn: async ({ org, status }: { org: OrgRow; status: "active" | "suspended" }) => {
      const { error } = await supabase.from("organizations").update({ status }).eq("id", org.id);
      if (error) throw error;
    },
    onSuccess: (_data, { org, status }) => {
      toast.success(status === "suspended" ? `${org.name} suspended.` : `${org.name} reactivated.`);
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not change status.")),
  });

  const recordPayment = useMutation({
    mutationFn: async (input: PaymentInput) => {
      const { data, error } = await supabase.rpc("record_client_payment", {
        _org_id: input.orgId,
        _amount: input.amount,
        _paid_on: input.paidOn,
        _months: input.months,
        _reference: input.reference.trim() || undefined,
        _note: input.note.trim() || undefined,
        _extend: input.extend,
      });
      if (error) throw error;
      return { newEnd: data, amount: input.amount };
    },
    onSuccess: ({ amount }) => {
      toast.success(`${formatNaira(amount)} recorded.`);
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not record the payment.")),
  });

  const voidPayment = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase.rpc("void_client_payment", { _payment_id: paymentId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment voided.");
      refresh();
    },
    onError: (error) => toast.error(friendly(error, "Could not void the payment.")),
  });

  return {
    ...derived,
    billingReady,
    loading: orgs.isLoading,
    loadError: orgs.isError ? friendly(orgs.error, "Could not load clients.") : null,
    events: events.data ?? [],
    createClient,
    saveClient,
    setStatus,
    recordPayment,
    voidPayment,
  };
}

export type PlatformData = ReturnType<typeof usePlatformData>;
