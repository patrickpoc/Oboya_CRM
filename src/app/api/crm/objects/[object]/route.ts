import { NextResponse } from "next/server";
import { buildSchema, fieldErrors } from "@/lib/crm/objects/schema";
import { parseListQuery } from "@/lib/crm/objects/query";
import {
  errorResponse,
  guardObject,
  invalid,
  readJson,
} from "@/lib/crm/objects/route-helpers";
import { create, list } from "@/lib/crm/repositories/object-repository";

type Ctx = { params: Promise<{ object: string }> };

/** GET /api/crm/objects/:object?view=&q=&sort=&dir=&page=&pageSize=&<field>= */
export async function GET(request: Request, { params }: Ctx) {
  const ctx = await guardObject((await params).object, "view");
  if (ctx instanceof NextResponse) return ctx;
  const query = parseListQuery(ctx.config, new URL(request.url).searchParams);
  try {
    const result = await list(ctx.guard.supabase, ctx.config, query, { userId: ctx.guard.user.id });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "list");
  }
}

/** POST /api/crm/objects/:object — body validated by buildSchema(config, "create"). */
export async function POST(request: Request, { params }: Ctx) {
  const ctx = await guardObject((await params).object, "create");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = buildSchema(ctx.config, "create").safeParse(await readJson(request));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  try {
    const record = await create(ctx.guard.supabase, ctx.config, parsed.data);
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "create");
  }
}
