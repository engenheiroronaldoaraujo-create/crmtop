import { assert, assertEquals } from "jsr:@std/assert@1";
import { bearerToken, isServiceRole } from "./auth.ts";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/functions/v1/x", { headers });
}

Deno.test("bearerToken: extrai o token do header Authorization", () => {
  assertEquals(bearerToken(req({ Authorization: "Bearer abc123" })), "abc123");
  assertEquals(bearerToken(req({ authorization: "bearer abc123" })), "abc123");
  assertEquals(bearerToken(req({ Authorization: "abc123" })), "abc123");
});

Deno.test("bearerToken: devolve vazio sem header", () => {
  assertEquals(bearerToken(req({})), "");
  // Header malformado ("Bearer" sem token) não vira token: o valor é
  // devolvido como está e não casa com nenhum segredo.
  assertEquals(bearerToken(req({ Authorization: "Bearer" })), "Bearer");
});

Deno.test("isServiceRole: false sem service role configurada", () => {
  // Sem a env var, NUNCA pode considerar a chamada interna (fail closed).
  const original = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (original === undefined) {
    assertEquals(
      isServiceRole(req({ Authorization: "Bearer qualquer" })),
      false,
    );
  }
});

Deno.test("isServiceRole: true só com o token exato da service role", () => {
  const original = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "srole-secreto");
    assertEquals(
      isServiceRole(req({ Authorization: "Bearer srole-secreto" })),
      true,
    );
    assertEquals(
      isServiceRole(req({ Authorization: "Bearer srole-secret" })),
      false,
    );
    assertEquals(isServiceRole(req({ Authorization: "Bearer " })), false);
    assertEquals(isServiceRole(req({})), false);
  } finally {
    if (original === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", original);
  }
});
