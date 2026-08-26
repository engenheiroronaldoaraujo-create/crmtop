// Testes do resolver LID → telefone (deno test).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractPhoneFromContactRow,
  extractRows,
  NEGATIVE_TTL_MS,
  resolveLidPhone,
  type LidCacheEntry,
  type LidCacheStore,
} from "./lid-phone-resolver.ts";

class MemoryStore implements LidCacheStore {
  map = new Map<string, LidCacheEntry>();
  async get(lid: string) {
    return this.map.get(lid) ?? null;
  }
  async put(entry: { lid: string; phone: string | null }) {
    const prev = this.map.get(entry.lid);
    this.map.set(entry.lid, {
      phone: entry.phone,
      resolved_at: entry.phone ? new Date().toISOString() : null,
      attempts: (prev?.attempts ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
    });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function countingFetch(
  responses: Array<(url: string, init?: RequestInit) => Response>,
): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push(url);
    const responder = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Promise.resolve(responder(url, init));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const BASE_OPTS = {
  baseUrl: "https://evo.example.com",
  apiKey: "test-key",
  instanceName: "5199",
};

Deno.test("extractPhoneFromContactRow — number direto com máscara vira canônico", () => {
  const phone = extractPhoneFromContactRow({
    id: "51295448752309@lid",
    number: "+55 31 98887-4298",
  });
  assertEquals(phone, "5531988874298");
});

Deno.test("extractPhoneFromContactRow — cai no id @s.whatsapp.net", () => {
  const phone = extractPhoneFromContactRow({
    id: "5531988887777@s.whatsapp.net",
    pushName: "Fulano",
  });
  assertEquals(phone, "5531988887777");
});

Deno.test("extractPhoneFromContactRow — rejeita lixo que não é telefone BR", () => {
  assertEquals(extractPhoneFromContactRow({ id: "51295448752309@lid" }), null);
  assertEquals(extractPhoneFromContactRow({ number: "123456789012345678" }), null);
  assertEquals(extractPhoneFromContactRow(null), null);
});

Deno.test("extractRows — aceita array, envelope .contacts/.data e objeto único", () => {
  assertEquals(extractRows([{ id: "a" }]).length, 1);
  assertEquals(extractRows({ contacts: [{ id: "b" }] }).length, 1);
  assertEquals(extractRows({ data: [{ id: "c" }] }).length, 1);
  assertEquals(extractRows({ id: "d" }).length, 1);
  assertEquals(extractRows("nope"), []);
});

Deno.test("resolveLidPhone — resolve via findContacts e grava cache positivo", async () => {
  const store = new MemoryStore();
  const { fn, calls } = countingFetch([
    (_url, init) => {
      assert(String(init?.body).includes("51295448752309@lid"));
      return jsonResponse({ contacts: [{ id: "51295448752309@lid", number: "3198887-4298" }] });
    },
  ]);

  const phone = await resolveLidPhone({
    ...BASE_OPTS,
    store,
    lidDigits: "lid:51295448752309",
    fetchFn: fn,
  });

  assertEquals(phone, "5531988874298");
  assertEquals(store.map.get("51295448752309")?.phone, "5531988874298");
  assertEquals(calls.length, 1);
});

Deno.test("resolveLidPhone — findContacts falha, cai no getContacts filtrando pelo LID", async () => {
  const store = new MemoryStore();
  const { fn, calls } = countingFetch([
    () => jsonResponse({ error: "not found" }, 404),
    () =>
      jsonResponse([
        { id: "999@lid", number: "5511999991111" },
        { id: "139586789458065@lid", number: "+55 31 98887-4298" },
      ]),
  ]);

  const phone = await resolveLidPhone({
    ...BASE_OPTS,
    store,
    lidDigits: "139586789458065",
    fetchFn: fn,
  });

  assertEquals(phone, "5531988874298");
  assert(calls[0].endsWith("/chat/findContacts/5199"));
  assert(calls[1].endsWith("/chat/getContacts/5199"));
});

Deno.test("resolveLidPhone — negative cache evita rede por 24h", async () => {
  const store = new MemoryStore();
  const { fn, calls } = countingFetch([
    () => jsonResponse([], 200),
  ]);

  const opts = { ...BASE_OPTS, store, lidDigits: "51295448752309", fetchFn: fn };

  assertEquals(await resolveLidPhone(opts), null);
  assertEquals(await resolveLidPhone(opts), null);
  assertEquals(await resolveLidPhone(opts), null);
  // Só a primeira tentativa bate na API: findContacts + fallback getContacts.
  assertEquals(calls.length, 2);
  assert(calls[0].endsWith("/chat/findContacts/5199"));
  assert(calls[1].endsWith("/chat/getContacts/5199"));
  assertEquals(store.map.get("51295448752309")?.attempts, 1);
});

Deno.test("resolveLidPhone — negative cache expirado tenta de novo", async () => {
  const store = new MemoryStore();
  await store.put({ lid: "42", phone: null });

  let nowMs = Date.now();
  const { fn, calls } = countingFetch([
    () => jsonResponse({ contacts: [{ number: "5531988887777" }] }),
  ]);

  nowMs += NEGATIVE_TTL_MS + 1000;

  const phone = await resolveLidPhone({
    ...BASE_OPTS,
    store,
    lidDigits: "42",
    fetchFn: fn,
    now: () => nowMs,
  });

  assertEquals(phone, "5531988887777");
  assertEquals(calls.length, 1);
});

Deno.test("resolveLidPhone — positive cache devolve sem rede", async () => {
  const store = new MemoryStore();
  await store.put({ lid: "99", phone: "5511999990000" });
  const { fn, calls } = countingFetch([() => jsonResponse({})]);

  const phone = await resolveLidPhone({
    ...BASE_OPTS,
    store,
    lidDigits: "99",
    fetchFn: fn,
  });

  assertEquals(phone, "5511999990000");
  assertEquals(calls.length, 0);
});
