// Seeds realistic demo data for Oboya CRM. Idempotent: demo users and teams are
// upserted by email / fixed id; demo records (external_ref like 'demo:%') and
// their audit rows are deleted and recreated on every run.
//
// Usage: SEED_ALLOW=1 SEED_PROJECT_REF=<ref> DEMO_PASSWORD='...' npm run seed:demo
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env, .env.local or .env).
// Never run against production: it creates users with a shared password.
// Guard: refuses to run unless SEED_ALLOW=1 and SEED_PROJECT_REF equals the
// project ref in NEXT_PUBLIC_SUPABASE_URL (https://<ref>.supabase.co; for a
// local stack the ref is the host, e.g. 127.0.0.1 or localhost).
// The demo super_admin is created only with SEED_CREATE_ADMIN=1.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(filename) {
  const filePath = path.join(rootDir, filename);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
const emailDomain = (process.env.DEMO_EMAIL_DOMAIN ?? "example.com").toLowerCase();

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("Set DEMO_PASSWORD (min 8 characters).");
  process.exit(1);
}

function projectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname.toLowerCase();
    return host.endsWith(".supabase.co") ? host.split(".")[0] : host;
  } catch {
    return "";
  }
}
const targetRef = projectRef(url);
if (process.env.SEED_ALLOW !== "1" || !targetRef || process.env.SEED_PROJECT_REF !== targetRef) {
  console.error(
    `Refusing to seed "${targetRef || url}". Set SEED_ALLOW=1 and SEED_PROJECT_REF=${targetRef || "<ref>"} ` +
      "to confirm this is a disposable demo/test project.",
  );
  process.exit(1);
}
const createAdmin = process.env.SEED_CREATE_ADMIN === "1";

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let seed = 20261116;
function rand() {
  // mulberry32: deterministic, so every run produces the same data set
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const HOUR = 36e5;
const DAY = 24 * HOUR;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const dateOnly = (ms) => iso(ms).slice(0, 10);
const slug = (value) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");

function must(result, label) {
  if (result.error) {
    console.error(`${label}: ${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}

async function insertChunks(table, rows, size = 100) {
  for (let i = 0; i < rows.length; i += size) {
    must(await db.from(table).insert(rows.slice(i, i + size)), `insert ${table}`);
  }
}

// Fixed ids from the migrations
const PIPELINE = "00000000-0000-4000-8000-000000000001";
const STAGES = {
  prospecting: "00000000-0000-4000-8000-000000000101",
  qualification: "00000000-0000-4000-8000-000000000102",
  needs: "00000000-0000-4000-8000-000000000103",
  proposal: "00000000-0000-4000-8000-000000000104",
  negotiation: "00000000-0000-4000-8000-000000000105",
  won: "00000000-0000-4000-8000-000000000106",
  lost: "00000000-0000-4000-8000-000000000107",
};
const ENTITY = {
  horticulture: "00000000-0000-4000-8000-000000000201",
  horticultura: "00000000-0000-4000-8000-000000000202",
  reciclagem: "00000000-0000-4000-8000-000000000203",
};
const TEAMS = [
  { id: "00000000-0000-4000-8000-000000000301", name: "Demo · Brazil" },
  { id: "00000000-0000-4000-8000-000000000302", name: "Demo · Europe & Africa" },
  { id: "00000000-0000-4000-8000-000000000303", name: "Demo · Asia & Latin America" },
];

// ---------------------------------------------------------------------------
// 1. Clean previous demo records (children first)
// ---------------------------------------------------------------------------
async function cleanDemo() {
  const tables = [
    ["crm_activities", "activity"],
    ["crm_leads", "lead"],
    ["crm_opportunities", "opportunity"],
    ["crm_contacts", "contact"],
    ["crm_accounts", "account"],
  ];
  for (const [table] of tables) {
    // leads point at demo accounts/contacts/opps; FKs are "set null", but clear first anyway
    if (table === "crm_accounts") {
      must(
        await db.from(table).update({ parent_account_id: null }).like("external_ref", "demo:%"),
        `unlink ${table}`,
      );
    }
    const ids = [];
    for (let from = 0; ; from += 1000) {
      const rows = must(
        await db.from(table).select("id").like("external_ref", "demo:%").range(from, from + 999),
        `select ${table}`,
      );
      ids.push(...rows.map((row) => row.id));
      if (rows.length < 1000) break;
    }
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      must(await db.from(table).delete().in("id", chunk), `delete ${table}`);
      must(await db.from("crm_audit_logs").delete().in("record_id", chunk), "delete audit");
    }
    if (ids.length) console.log(`Removed ${ids.length} demo rows from ${table}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Teams and users
// ---------------------------------------------------------------------------
const ALL_USERS = [
  { key: "admin", name: "Marina Alves", role: "super_admin", team: null, locale: "pt-BR" },
  { key: "mgr_br", name: "Ricardo Souza", role: "sales_manager", team: 0, locale: "pt-BR" },
  { key: "mgr_eu", name: "Sanne de Vries", role: "sales_manager", team: 1, locale: "en" },
  { key: "rep_br1", name: "Lucas Pereira", role: "sales_rep", team: 0, locale: "pt-BR", inbound: true },
  { key: "rep_br2", name: "Camila Rocha", role: "sales_rep", team: 0, locale: "pt-BR", inbound: true },
  { key: "rep_eu", name: "Pieter Bakker", role: "sales_rep", team: 1, locale: "en", inbound: true },
  { key: "rep_intl", name: "Javier Morales", role: "sales_rep", team: 2, locale: "es", inbound: true },
  { key: "viewer", name: "Wei Zhang", role: "read_only", team: 2, locale: "zh-CN" },
];
// The demo super_admin is opt-in (SEED_CREATE_ADMIN=1); records never belong to it.
const USERS = ALL_USERS.filter((user) => createAdmin || user.role !== "super_admin");
// Ricardo manages Brazil and Asia & Latin America (a manager can manage several teams).
const TEAM_MANAGERS = { 0: "mgr_br", 1: "mgr_eu", 2: "mgr_br" };

async function listAllAuthUsers() {
  const all = [];
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    all.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return all;
}

async function seedUsers() {
  must(
    await db.from("crm_teams").upsert(
      TEAMS.map((team) => ({ id: team.id, name: team.name, description: "Demo team" })),
      { onConflict: "id" },
    ),
    "upsert teams",
  );

  const existing = await listAllAuthUsers();
  const ids = {};
  for (const user of USERS) {
    const email = `demo.${slug(user.name)}@${emailDomain}`;
    user.email = email;
    const found = existing.find((u) => u.email?.toLowerCase() === email);
    let id;
    if (found) {
      const { error } = await db.auth.admin.updateUserById(found.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: user.name, demo: true },
      });
      if (error) throw new Error(`update ${email}: ${error.message}`);
      id = found.id;
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: user.name, demo: true },
        app_metadata: { must_change_password: false },
      });
      if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
      id = data.user.id;
    }
    ids[user.key] = id;
    must(
      await db.from("crm_users").upsert(
        {
          id,
          email,
          full_name: user.name,
          role: user.role,
          team_id: user.team === null ? null : TEAMS[user.team].id,
          status: "active",
          locale: user.locale,
          receives_inbound: Boolean(user.inbound),
        },
        { onConflict: "id" },
      ),
      `upsert crm_users ${email}`,
    );
  }

  for (const [index, managerKey] of Object.entries(TEAM_MANAGERS)) {
    must(
      await db.from("crm_teams").update({ manager_id: ids[managerKey] }).eq("id", TEAMS[index].id),
      "set team manager",
    );
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 3. Records
// ---------------------------------------------------------------------------
const PEOPLE = {
  BR: [["Ana", "Oliveira"], ["João", "Santos"], ["Mariana", "Costa"], ["Rafael", "Lima"], ["Beatriz", "Ferreira"], ["Thiago", "Ribeiro"], ["Juliana", "Carvalho"], ["Gustavo", "Martins"]],
  NL: [["Jan", "Jansen"], ["Femke", "Visser"], ["Daan", "Smit"], ["Lotte", "Mulder"], ["Bram", "de Boer"], ["Eva", "Meijer"]],
  ES: [["Carmen", "García"], ["Alejandro", "Martínez"], ["Lucía", "López"], ["Pablo", "Sánchez"], ["Elena", "Romero"]],
  CN: [["Li", "Wang"], ["Mei", "Chen"], ["Jun", "Liu"], ["Xiu", "Zhao"], ["Hao", "Yang"]],
  MX: [["Sofía", "Hernández"], ["Diego", "Ramírez"], ["Valeria", "Torres"], ["Andrés", "Flores"], ["Fernanda", "Cruz"]],
  CO: [["Daniela", "Gómez"], ["Santiago", "Rodríguez"], ["Camila", "Díaz"], ["Felipe", "Moreno"], ["Laura", "Vargas"]],
  KE: [["Wanjiru", "Kamau"], ["Otieno", "Odhiambo"], ["Akinyi", "Achieng"], ["Kiprono", "Kiptoo"], ["Njeri", "Mwangi"]],
};

// name, country, type, segment, industry, entities, city
const ACCOUNTS = [
  ["Agro Verde Holambra Ltda", "BR", "customer", "floriculture", "flowers_plants", ["horticultura"], "Holambra"],
  ["Estufas Paulista Ltda", "BR", "customer", "greenhouse_grower", "fruit_vegetables", ["horticultura", "reciclagem"], "Campinas"],
  ["Viveiro Mata Atlântica", "BR", "prospect", "nursery", "flowers_plants", ["horticultura"], "Joinville"],
  ["Recicla Agro Paraná Ltda", "BR", "partner", "recycling", "recycling", ["reciclagem"], "Londrina"],
  ["Distribuidora Campo Bom", "BR", "distributor", "distributor", "agri_inputs", ["horticultura"], "Ribeirão Preto"],
  ["Frutas do Cerrado S.A.", "BR", "prospect", "open_field_grower", "fruit_vegetables", ["horticultura", "reciclagem"], "Petrolina"],
  ["Westland Kassen B.V.", "NL", "customer", "greenhouse_grower", "fruit_vegetables", ["horticulture"], "Naaldwijk"],
  ["Van der Berg Plantenkwekerij", "NL", "prospect", "nursery", "flowers_plants", ["horticulture"], "Boskoop"],
  ["Aalsmeer Bloom Trading B.V.", "NL", "distributor", "distributor", "flowers_plants", ["horticulture"], "Aalsmeer"],
  ["Greenport Substrates B.V.", "NL", "partner", "other", "agri_inputs", ["horticulture"], "Venlo"],
  ["Invernaderos del Poniente S.L.", "ES", "customer", "greenhouse_grower", "fruit_vegetables", ["horticulture"], "El Ejido"],
  ["Viveros Levante S.A.", "ES", "prospect", "nursery", "flowers_plants", ["horticulture"], "Valencia"],
  ["Agrícola Murciana S.L.", "ES", "prospect", "open_field_grower", "fruit_vegetables", ["horticulture"], "Murcia"],
  ["Shandong Green Harvest Co., Ltd.", "CN", "customer", "greenhouse_grower", "fruit_vegetables", ["horticulture"], "Shouguang"],
  ["Yunnan Flower Valley Co., Ltd.", "CN", "prospect", "floriculture", "flowers_plants", ["horticulture"], "Kunming"],
  ["Qingdao Agri Supply Co., Ltd.", "CN", "distributor", "distributor", "agri_inputs", ["horticulture"], "Qingdao"],
  ["Invernaderos de Jalisco S.A. de C.V.", "MX", "customer", "greenhouse_grower", "fruit_vegetables", ["horticulture"], "Guadalajara"],
  ["Berries del Bajío S.A. de C.V.", "MX", "prospect", "open_field_grower", "fruit_vegetables", ["horticulture"], "Irapuato"],
  ["Agroinsumos Sinaloa", "MX", "distributor", "distributor", "agri_inputs", ["horticulture"], "Culiacán"],
  ["Flores de la Sabana S.A.S.", "CO", "customer", "floriculture", "flowers_plants", ["horticulture"], "Madrid, Cundinamarca"],
  ["Cultivos Antioquia S.A.S.", "CO", "prospect", "greenhouse_grower", "fruit_vegetables", ["horticulture"], "Rionegro"],
  ["Rosas de Cundinamarca S.A.S.", "CO", "prospect", "floriculture", "flowers_plants", ["horticulture"], "Facatativá"],
  ["Naivasha Rose Farms Ltd", "KE", "customer", "floriculture", "flowers_plants", ["horticulture"], "Naivasha"],
  ["Rift Valley Horticulture Ltd", "KE", "prospect", "open_field_grower", "fruit_vegetables", ["horticulture"], "Nakuru"],
  ["Mount Kenya Greens Ltd", "KE", "prospect", "greenhouse_grower", "fruit_vegetables", ["horticulture"], "Nanyuki"],
];

const CURRENCY = { BR: "BRL", NL: "EUR", ES: "EUR", CN: "USD", MX: "USD", CO: "USD", KE: "USD" };
const LOCALE = { BR: "pt-BR", NL: "en", ES: "es", CN: "zh-CN", MX: "es", CO: "es", KE: "en" };
const TITLES = ["Purchasing Manager", "Owner", "Operations Director", "Head Grower", "Procurement Lead", "General Manager", "Technical Manager"];
const PRODUCTS = ["greenhouse film", "shade nets", "growing trays", "substrate", "drip irrigation kits", "crates and packaging", "recycled plastic pallets", "ground cover"];

function ownersFor(country, ids) {
  if (country === "BR") return [ids.rep_br1, ids.rep_br2, ids.mgr_br];
  if (country === "NL" || country === "ES" || country === "KE") return [ids.rep_eu, ids.mgr_eu];
  return [ids.rep_intl];
}

function buildRecords(ids) {
  const accounts = [];
  const accountEntities = [];
  const contacts = [];
  const opportunities = [];
  const leads = [];
  const activities = [];

  // Accounts + contacts (2 per account)
  ACCOUNTS.forEach(([name, country, type, segment, industry, entities, city], i) => {
    const id = randomUUID();
    const owner = pick(ownersFor(country, ids));
    const created = now - between(30, 400) * DAY;
    const domain = `${slug(name).split(".").slice(0, 2).join("")}.example`;
    accounts.push({
      id,
      name,
      type,
      country_code: country,
      segment,
      industry,
      website: `https://www.${domain}`,
      phone: `+${between(10, 99)} ${between(100, 999)} ${between(1000, 9999)}`,
      billing_city: city,
      billing_country_code: country,
      owner_id: owner,
      created_by: owner,
      created_at: iso(created),
      external_ref: `demo:account:${String(i + 1).padStart(2, "0")}`,
    });
    entities.forEach((entity, n) => {
      accountEntities.push({
        account_id: id,
        entity_id: ENTITY[entity],
        is_primary: n === 0,
        since: dateOnly(created),
      });
    });
    const people = [...PEOPLE[country]].sort(() => rand() - 0.5).slice(0, 2);
    people.forEach(([first, last], n) => {
      contacts.push({
        id: randomUUID(),
        account_id: id,
        first_name: first,
        last_name: last,
        email: `${slug(first)}.${slug(last)}@${domain}`,
        phone: `+${between(10, 99)} ${between(10000000, 99999999)}`,
        title: TITLES[(i + n) % TITLES.length],
        country_code: country,
        locale: LOCALE[country],
        owner_id: owner,
        created_by: owner,
        created_at: iso(created + between(0, 5) * DAY),
        external_ref: `demo:contact:${String(contacts.length + 1).padStart(2, "0")}`,
      });
    });
    accounts[i].__country = country;
    accounts[i].__entity = ENTITY[entities[0]];
  });

  // Opportunities: 35 across stages
  const stagePlan = [
    ...Array(6).fill("prospecting"),
    ...Array(6).fill("qualification"),
    ...Array(5).fill("needs"),
    ...Array(5).fill("proposal"),
    ...Array(4).fill("negotiation"),
    ...Array(5).fill("won"),
    ...Array(4).fill("lost"),
  ];
  const lossReasons = ["price", "competitor", "no_budget", "timing", "no_response", "product_fit"];
  stagePlan.forEach((stage, i) => {
    const account = accounts[i % accounts.length];
    const contact = contacts.find((c) => c.account_id === account.id);
    const closed = stage === "won" || stage === "lost";
    const created = now - between(10, 200) * DAY;
    const closeMs = closed ? now - between(2, 60) * DAY : now + between(5, 150) * DAY;
    const currency = account.__country === "BR" ? "BRL" : rand() < 0.5 ? "USD" : CURRENCY[account.__country];
    const product = pick(PRODUCTS);
    opportunities.push({
      id: randomUUID(),
      name: `${account.name.split(" ").slice(0, 3).join(" ")} - ${product}`,
      account_id: account.id,
      primary_contact_id: contact?.id ?? null,
      pipeline_id: PIPELINE,
      stage_id: STAGES[stage],
      amount: between(8, 450) * 1000,
      currency,
      close_date: dateOnly(closeMs),
      closed_at: closed ? iso(closeMs) : null,
      loss_reason: stage === "lost" ? lossReasons[i % lossReasons.length] : null,
      loss_note: stage === "lost" ? "Customer chose another supplier for this season." : null,
      entity_id: account.__entity,
      lead_source: pick(["website_rfq", "trade_show", "referral", "cold_outreach", "partner"]),
      next_step: closed ? null : pick(["Send samples", "Schedule site visit", "Send revised quote", "Call to confirm volumes"]),
      owner_id: account.owner_id,
      created_by: account.owner_id,
      created_at: iso(created),
      external_ref: `demo:opportunity:${String(i + 1).padStart(2, "0")}`,
    });
  });

  // Leads: 60 in every status, some past the 24h / 48h SLA
  const leadPlan = [
    ...Array(20).fill("new"),
    ...Array(18).fill("working"),
    ...Array(12).fill("qualified"),
    ...Array(10).fill("unqualified"),
  ];
  const leadCompanies = [
    "Hortícola San Isidro", "Green Valley Growers", "Fazenda Boa Esperança", "Bloemenkwekerij Hollands Glorie",
    "Huerta Murcia Fresh", "Guangzhou Fresh Farms", "Tomates de Querétaro", "Flores El Rosal",
    "Kericho Fresh Produce", "Sítio Três Irmãos", "Agro Andina", "Kas & Teelt Westland",
  ];
  const countries = Object.keys(PEOPLE);
  const reps = [ids.rep_br1, ids.rep_br2, ids.rep_eu, ids.rep_intl, ids.mgr_br, ids.mgr_eu];
  const unqualifiedReasons = ["No budget", "Student / research request", "Duplicate", "Outside target market", "No response after 3 attempts"];
  leadPlan.forEach((status, i) => {
    const country = countries[i % countries.length];
    const [first, last] = PEOPLE[country][i % PEOPLE[country].length];
    const company = `${leadCompanies[i % leadCompanies.length]}${i >= leadCompanies.length ? ` ${Math.floor(i / leadCompanies.length) + 1}` : ""}`;
    const source = pick(["website_contact", "website_rfq", "website_rfq", "trade_show", "referral", "cold_outreach", "partner", "other"]);
    let ageHours;
    if (status === "new") ageHours = [2, 6, 20, 30, 40, 55, 72][i % 7];
    else ageHours = between(48, 24 * 90);
    const created = now - ageHours * HOUR;
    const lead = {
      id: randomUUID(),
      first_name: first,
      last_name: last,
      company,
      title: pick(TITLES),
      email: `${slug(first)}.${slug(last)}.${i + 1}@${slug(company).replace(/\./g, "")}.example`,
      phone: `+${between(10, 99)} ${between(10000000, 99999999)}`,
      country_code: country,
      locale: LOCALE[country],
      status,
      unqualified_reason: status === "unqualified" ? pick(unqualifiedReasons) : null,
      source,
      priority: pick(["low", "normal", "normal", "normal", "high", "urgent"]),
      rating: pick(["hot", "warm", "cold", null]),
      tags: rand() < 0.4 ? [pick(["vip", "export", "follow-up", "sample"])] : [],
      segment: pick(["greenhouse_grower", "open_field_grower", "nursery", "floriculture", "distributor"]),
      industry: pick(["horticulture", "fruit_vegetables", "flowers_plants"]),
      message: `Interested in ${pick(PRODUCTS)} for the coming season. Please send prices and lead times.`,
      entity_id: country === "BR" ? pick([ENTITY.horticultura, ENTITY.horticultura, ENTITY.reciclagem]) : ENTITY.horticulture,
      first_responded_at: status === "new" ? null : iso(created + between(1, 30) * HOUR),
      last_activity_at: status === "new" ? null : iso(created + between(1, 10) * DAY),
      owner_id: country === "BR" ? pick([ids.rep_br1, ids.rep_br2]) : pick(reps),
      created_at: iso(created),
      external_ref: `demo:lead:${String(i + 1).padStart(2, "0")}`,
      raw_payload: source.startsWith("website") ? { type: source === "website_rfq" ? "quote" : "contact", demo: true } : null,
    };
    lead.created_by = lead.owner_id;
    // Half of the qualified leads are converted into the demo accounts/contacts/opps
    if (status === "qualified" && i % 2 === 0) {
      const opp = opportunities[i % opportunities.length];
      lead.converted_at = iso(created + between(2, 20) * DAY);
      lead.converted_account_id = opp.account_id;
      lead.converted_contact_id = opp.primary_contact_id;
      lead.converted_opportunity_id = opp.id;
      lead.owner_id = opp.owner_id;
      lead.created_by = opp.owner_id;
    }
    leads.push(lead);
  });

  // Activities: ~120 (tasks past / today / future, calls, meetings, notes)
  const parents = [
    ...leads.filter((l) => !l.converted_at).map((l) => ["lead", l.id, l.owner_id, null]),
    ...accounts.map((a) => ["account", a.id, a.owner_id, contacts.find((c) => c.account_id === a.id)?.id ?? null]),
    ...opportunities.map((o) => ["opportunity", o.id, o.owner_id, o.primary_contact_id]),
  ];
  const subjects = {
    task: ["Send updated price list", "Prepare RFQ quote", "Follow up on samples", "Confirm delivery schedule", "Check credit terms"],
    call: ["Discovery call", "Follow-up call", "Pricing discussion", "Call about pending order"],
    meeting: ["Site visit", "Product demo", "Quarterly business review", "Trade show meeting"],
    note: ["Customer feedback", "Competitor info", "Visit notes", "Internal note"],
  };
  const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  for (let i = 0; i < 120; i += 1) {
    const [whatObject, whatId, owner, who] = parents[i % parents.length];
    const type = ["task", "task", "task", "call", "call", "meeting", "note"][i % 7];
    let dueAt = null;
    let status = "done";
    let completedAt = null;
    if (type === "task") {
      const bucket = i % 4; // overdue, today, upcoming, done
      if (bucket === 0) { dueAt = now - between(1, 10) * DAY; status = "open"; }
      else if (bucket === 1) { dueAt = startOfToday + between(9, 18) * HOUR; status = "open"; }
      else if (bucket === 2) { dueAt = now + between(1, 21) * DAY; status = "open"; }
      else { dueAt = now - between(1, 30) * DAY; completedAt = dueAt; }
    } else if (type === "meeting") {
      if (i % 2 === 0) { dueAt = now + between(1, 14) * DAY; status = "open"; }
      else { dueAt = now - between(1, 45) * DAY; completedAt = dueAt; }
    } else {
      dueAt = now - between(1, 60) * DAY;
      completedAt = dueAt;
    }
    activities.push({
      id: randomUUID(),
      type,
      subject: pick(subjects[type]),
      body: type === "note" || type === "call" ? "Discussed volumes for next season and delivery windows." : null,
      status,
      priority: pick(["low", "normal", "normal", "high", "urgent"]),
      due_at: iso(dueAt),
      duration_minutes: type === "meeting" ? 60 : type === "call" ? 15 : null,
      completed_at: completedAt ? iso(completedAt) : null,
      what_object: whatObject,
      what_id: whatId,
      who_contact_id: who,
      owner_id: owner,
      created_by: owner,
      created_at: iso(Math.min(now, (completedAt ?? dueAt) - 2 * DAY)),
      external_ref: `demo:activity:${String(i + 1).padStart(3, "0")}`,
    });
  }

  for (const account of accounts) {
    delete account.__country;
    delete account.__entity;
  }
  return { accounts, accountEntities, contacts, opportunities, leads, activities };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
await cleanDemo();
const ids = await seedUsers();
const data = buildRecords(ids);

await insertChunks("crm_accounts", data.accounts);
await insertChunks("crm_account_entities", data.accountEntities);
await insertChunks("crm_contacts", data.contacts);
await insertChunks("crm_opportunities", data.opportunities);
await insertChunks("crm_leads", data.leads);
await insertChunks("crm_activities", data.activities);

console.log(
  `Seeded ${data.accounts.length} accounts, ${data.contacts.length} contacts, ` +
    `${data.leads.length} leads, ${data.opportunities.length} opportunities, ` +
    `${data.activities.length} activities.`,
);
console.log("\nDemo users (password = DEMO_PASSWORD):");
for (const user of USERS) {
  console.log(`  ${user.role.padEnd(14)} ${user.email}  (${user.name})`);
}
