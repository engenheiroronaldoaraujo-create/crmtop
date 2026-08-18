// 026_commercial_test.ts
// Tests for the commercial module foundation.
// Run: deno test --allow-net supabase/functions/_shared/026_commercial_test.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Test data
const TEST_PIPELINE_ID = "a0000000-0000-0000-0000-000000000001";
const TEST_STAGE_NOVO = "b0000000-0000-0000-0000-000000000001";
const TEST_STAGE_PROPOSTA = "b0000000-0000-0000-0000-000000000005";
const TEST_STAGE_GANHO = "b0000000-0000-0000-0000-000000000007";
const TEST_STAGE_PERDIDO = "b0000000-0000-0000-0000-000000000008";

let testContactId: string;
let testOpportunityId: string;
let testTaskId: string;
let testMeetingId: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Create pipeline
// ---------------------------------------------------------------------------

Deno.test("1. Pipeline seed exists", async () => {
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("id", TEST_PIPELINE_ID)
    .single();
  assert(!error, "No error");
  assert(data?.name === "Vendas", "Pipeline name is Vendas");
  assert(data?.is_default === true, "Pipeline is default");
});

// ---------------------------------------------------------------------------
// 2. Create stage
// ---------------------------------------------------------------------------

Deno.test("2. Pipeline stages exist", async () => {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", TEST_PIPELINE_ID)
    .order("position");
  assert(!error, "No error");
  assert(data?.length === 8, `8 stages, got ${data?.length}`);
  assert(data?.[0]?.name === "Novo", "First stage is Novo");
  assert(data?.[7]?.name === "Perdido", "Last stage is Perdido");
});

// ---------------------------------------------------------------------------
// 3. Create opportunity
// ---------------------------------------------------------------------------

Deno.test("3. Create opportunity", async () => {
  // First create a test contact
  const { data: contact } = await supabase
    .from("contacts")
    .insert({ phone: "5599999999999", name: "Test Commercial Contact", source: "manual" })
    .select()
    .single();
  testContactId = contact!.id;

  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      contact_id: testContactId,
      pipeline_id: TEST_PIPELINE_ID,
      stage_id: TEST_STAGE_NOVO,
      title: "Test Opportunity",
      description: "Test description",
      value: 1500,
      currency: "BRL",
      probability: 20,
    })
    .select()
    .single();
  assert(!error, "No error creating opportunity");
  assert(data?.title === "Test Opportunity", "Title matches");
  assert(data?.status === "open", "Status is open");
  assert(data?.value === 1500, "Value matches");
  testOpportunityId = data!.id;
});

// ---------------------------------------------------------------------------
// 4. Associate opportunity to contact
// ---------------------------------------------------------------------------

Deno.test("4. Opportunity linked to contact", async () => {
  const { data } = await supabase
    .from("opportunities")
    .select("contact:contacts(id, name)")
    .eq("id", testOpportunityId)
    .single();
  assert((data?.contact as any)?.name === "Test Commercial Contact", "Contact linked");
});

// ---------------------------------------------------------------------------
// 5. Associate opportunity to user
// ---------------------------------------------------------------------------

Deno.test("5. Assign opportunity to user", async () => {
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1);
  const adminId = profiles?.[0]?.id;
  if (!adminId) { console.log("  ⚠ No admin user found, skipping"); return; }

  const { error } = await supabase
    .from("opportunities")
    .update({ assigned_to: adminId })
    .eq("id", testOpportunityId);
  assert(!error, "No error assigning");
  const { data } = await supabase
    .from("opportunities")
    .select("assigned_to")
    .eq("id", testOpportunityId)
    .single();
  assert(data?.assigned_to === adminId, "Assigned to admin");
});

// ---------------------------------------------------------------------------
// 6. Move stage
// ---------------------------------------------------------------------------

Deno.test("6. Move opportunity stage", async () => {
  const { error } = await supabase.rpc("move_opportunity_stage", {
    p_opportunity_id: testOpportunityId,
    p_new_stage_id: TEST_STAGE_PROPOSTA,
  });
  assert(!error, "No error moving stage");
  const { data } = await supabase
    .from("opportunities")
    .select("stage_id")
    .eq("id", testOpportunityId)
    .single();
  assert(data?.stage_id === TEST_STAGE_PROPOSTA, "Stage updated to Proposta");
});

// ---------------------------------------------------------------------------
// 7. Stage history recorded
// ---------------------------------------------------------------------------

Deno.test("7. Stage history recorded", async () => {
  const { data, error } = await supabase
    .from("opportunity_stage_history")
    .select("*")
    .eq("opportunity_id", testOpportunityId)
    .order("changed_at", { ascending: false });
  assert(!error, "No error");
  assert(data?.length === 1, `1 history entry, got ${data?.length}`);
  assert(data?.[0]?.old_stage_id === TEST_STAGE_NOVO, "Old stage is Novo");
  assert(data?.[0]?.new_stage_id === TEST_STAGE_PROPOSTA, "New stage is Proposta");
});

// ---------------------------------------------------------------------------
// 8. Create task
// ---------------------------------------------------------------------------

Deno.test("8. Create task", async () => {
  const { data, error } = await supabase
    .from("opportunity_tasks")
    .insert({
      opportunity_id: testOpportunityId,
      contact_id: testContactId,
      title: "Enviar proposta",
      task_type: "task",
      due_at: new Date(Date.now() + 86400000).toISOString(),
      priority: "high",
    })
    .select()
    .single();
  assert(!error, "No error creating task");
  assert(data?.title === "Enviar proposta", "Title matches");
  assert(data?.status === "pending", "Status is pending");
  testTaskId = data!.id;
});

// ---------------------------------------------------------------------------
// 9. Complete task
// ---------------------------------------------------------------------------

Deno.test("9. Complete task", async () => {
  const { error } = await supabase.rpc("complete_task", { p_task_id: testTaskId });
  assert(!error, "No error completing task");
  const { data } = await supabase
    .from("opportunity_tasks")
    .select("status, completed_at")
    .eq("id", testTaskId)
    .single();
  assert(data?.status === "completed", "Status is completed");
  assert(data?.completed_at !== null, "completed_at is set");
});

// ---------------------------------------------------------------------------
// 10. Create meeting
// ---------------------------------------------------------------------------

Deno.test("10. Create meeting", async () => {
  const { data, error } = await supabase
    .from("meetings")
    .insert({
      opportunity_id: testOpportunityId,
      contact_id: testContactId,
      title: "Reunião de proposta",
      start_at: new Date(Date.now() + 172800000).toISOString(),
      end_at: new Date(Date.now() + 175200000).toISOString(),
      location: "Escritório",
    })
    .select()
    .single();
  assert(!error, "No error creating meeting");
  assert(data?.title === "Reunião de proposta", "Title matches");
  assert(data?.status === "scheduled", "Status is scheduled");
  testMeetingId = data!.id;
});

// ---------------------------------------------------------------------------
// 11. Cancel meeting
// ---------------------------------------------------------------------------

Deno.test("11. Cancel meeting", async () => {
  const { error } = await supabase
    .from("meetings")
    .update({ status: "cancelled" })
    .eq("id", testMeetingId);
  assert(!error, "No error cancelling meeting");
  const { data } = await supabase
    .from("meetings")
    .select("status")
    .eq("id", testMeetingId)
    .single();
  assert(data?.status === "cancelled", "Status is cancelled");
});

// ---------------------------------------------------------------------------
// 12. Create follow-up
// ---------------------------------------------------------------------------

Deno.test("12. Create follow-up", async () => {
  const { data, error } = await supabase
    .from("opportunity_tasks")
    .insert({
      opportunity_id: testOpportunityId,
      contact_id: testContactId,
      title: "Ligar novamente amanhã",
      task_type: "follow_up",
      due_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .select()
    .single();
  assert(!error, "No error creating follow-up");
  assert(data?.task_type === "follow_up", "Type is follow_up");
});

// ---------------------------------------------------------------------------
// 13. Win opportunity
// ---------------------------------------------------------------------------

Deno.test("13. Win opportunity", async () => {
  const { error } = await supabase
    .from("opportunities")
    .update({ status: "won", closed_at: new Date().toISOString() })
    .eq("id", testOpportunityId);
  assert(!error, "No error winning");
  const { data } = await supabase
    .from("opportunities")
    .select("status, closed_at")
    .eq("id", testOpportunityId)
    .single();
  assert(data?.status === "won", "Status is won");
  assert(data?.closed_at !== null, "closed_at is set");
});

// ---------------------------------------------------------------------------
// 14. Lose opportunity (test with new opportunity)
// ---------------------------------------------------------------------------

Deno.test("14. Lose opportunity", async () => {
  const { data: opp } = await supabase
    .from("opportunities")
    .insert({
      contact_id: testContactId,
      pipeline_id: TEST_PIPELINE_ID,
      stage_id: TEST_STAGE_NOVO,
      title: "Test Lose Opportunity",
    })
    .select()
    .single();

  const { error } = await supabase
    .from("opportunities")
    .update({ status: "lost", lost_reason: "Preço alto", closed_at: new Date().toISOString() })
    .eq("id", opp!.id);
  assert(!error, "No error losing");
  const { data } = await supabase
    .from("opportunities")
    .select("status, lost_reason")
    .eq("id", opp!.id)
    .single();
  assert(data?.status === "lost", "Status is lost");
  assert(data?.lost_reason === "Preço alto", "Lost reason recorded");
});

// ---------------------------------------------------------------------------
// 15. RLS: authenticated can read opportunities
// ---------------------------------------------------------------------------

Deno.test("15. RLS - authenticated read opportunities", async () => {
  const { data: { session } } = await supabase.auth.signInWithPassword({
    email: "arauadm@gmail.com",
    password: "24171920",
  });
  if (!session) { console.log("  ⚠ Could not sign in, skipping"); return; }

  const userClient = createClient(SUPABASE_URL, SUPABASE_URL, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });

  const { data, error } = await userClient
    .from("opportunities")
    .select("id")
    .limit(1);
  assert(!error, "Authenticated user can read opportunities");
  assert((data?.length ?? 0) > 0, "At least one opportunity visible");
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

Deno.test("Cleanup: remove test data", async () => {
  // Delete tasks first (FK dependency)
  await supabase.from("opportunity_tasks").delete().eq("opportunity_id", testOpportunityId);
  await supabase.from("meetings").delete().eq("id", testMeetingId);
  await supabase.from("opportunity_stage_history").delete().eq("opportunity_id", testOpportunityId);
  // Delete other test opportunities
  const { data: opps } = await supabase.from("opportunities").select("id").like("title", "Test%");
  if (opps) {
    for (const o of opps) {
      await supabase.from("opportunity_tasks").delete().eq("opportunity_id", o.id);
      await supabase.from("opportunity_stage_history").delete().eq("opportunity_id", o.id);
      await supabase.from("opportunities").delete().eq("id", o.id);
    }
  }
  // Delete test contact
  await supabase.from("contacts").delete().eq("id", testContactId);
  console.log("  ✓ Test data cleaned up");
});
