import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  Building2,
  CalendarCheck,
  ChartColumn,
  Contact,
  Handshake,
  History,
  House,
  LayoutList,
  LifeBuoy,
  ListChecks,
  ListTree,
  Megaphone,
  Settings,
  Shield,
  Shuffle,
  Target,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";
import type { CrmAction, CrmModule } from "@/lib/crm/types";
import { ROADMAP_GROUPS, roadmap, type RoadmapGroup } from "@/lib/crm/roadmap";

export type NavBadgeKey = "leadsNew" | "tasksDue";
export type NavCounts = Partial<Record<NavBadgeKey, number>>;

export interface CrmNavItem {
  /** Key under `nav.*` */
  labelKey: string;
  /** English fallback for non-i18n callers */
  label: string;
  href?: string;
  icon?: LucideIcon;
  module?: CrmModule;
  /** When true, sidebar shows only for Super Admin (in addition to can()). */
  superAdminOnly?: boolean;
  /** Sidebar count badge sourced from `/api/crm/nav-counts`. */
  badge?: NavBadgeKey;
  /** Planned module from the roadmap registry: shows a "Soon" badge. */
  soon?: boolean;
  children?: CrmNavItem[];
}

const GROUP_ICONS: Record<RoadmapGroup, LucideIcon> = {
  sales: Briefcase,
  service: LifeBuoy,
  marketing: Megaphone,
  insights: ChartColumn,
  platform: Workflow,
};

const GROUP_LABELS: Record<RoadmapGroup, string> = {
  sales: "Sales",
  service: "Service",
  marketing: "Marketing",
  insights: "Insights",
  platform: "Platform",
};

/**
 * Roadmap entries in a sidebar group. Planned entries keep the "Soon" flag and
 * stay visible to everyone; live entries carry their permission module.
 */
function roadmapItems(group: RoadmapGroup): CrmNavItem[] {
  return roadmap
    .filter((entry) => entry.group === group)
    .map((entry) => ({
      labelKey: entry.id,
      label: entry.id,
      href: entry.href,
      icon: entry.icon,
      module: entry.module,
      soon: entry.status === "planned",
    }));
}

const salesGroup: CrmNavItem = {
  labelKey: "sales",
  label: GROUP_LABELS.sales,
  icon: GROUP_ICONS.sales,
  children: [
    { labelKey: "leads", label: "Leads", href: "/leads", icon: Target, module: "leads", badge: "leadsNew" },
    { labelKey: "accounts", label: "Accounts", href: "/accounts", icon: Building2, module: "accounts" },
    { labelKey: "contacts", label: "Contacts", href: "/contacts", icon: Contact, module: "contacts" },
    {
      labelKey: "opportunities",
      label: "Opportunities",
      href: "/opportunities",
      icon: Handshake,
      module: "opportunities",
      children: [
        {
          labelKey: "pipeline",
          label: "Pipeline",
          href: "/opportunities/pipeline",
          module: "opportunities",
        },
      ],
    },
    { labelKey: "activities", label: "Activities", href: "/activities", icon: CalendarCheck, module: "activities" },
    { labelKey: "tasks", label: "My tasks", href: "/tasks", icon: ListChecks, module: "activities", badge: "tasksDue" },
    ...roadmapItems("sales"),
  ],
};

const plannedGroups: CrmNavItem[] = ROADMAP_GROUPS.filter((group) => group !== "sales")
  .map((group) => ({
    labelKey: group,
    label: GROUP_LABELS[group],
    icon: GROUP_ICONS[group],
    children: roadmapItems(group),
  }))
  .filter((group) => group.children.length > 0);

const setupGroup: CrmNavItem = {
  labelKey: "setup",
  label: "Setup",
  icon: Settings,
  children: [
    { labelKey: "users", label: "Users", href: "/setup/users", icon: Users, module: "setup_users" },
    { labelKey: "roles", label: "Roles", href: "/setup/roles", icon: UserCog, module: "setup_roles" },
    { labelKey: "access", label: "Access", href: "/setup/access", icon: Shield, module: "setup_access" },
    { labelKey: "companies", label: "Companies", href: "/setup/companies", icon: Building2, module: "setup_companies" },
    { labelKey: "pipelineStages", label: "Pipeline stages", href: "/setup/pipeline", icon: LayoutList, module: "setup_pipeline" },
    { labelKey: "picklists", label: "Picklists", href: "/setup/picklists", icon: ListTree, module: "setup_picklists" },
    { labelKey: "leadAssignment", label: "Lead assignment", href: "/setup/lead-assignment", icon: Shuffle, module: "setup_lead_assignment" },
    { labelKey: "auditLog", label: "Audit log", href: "/setup/audit-log", icon: History, module: "audit_logs" },
  ],
};

export const crmNavigation: CrmNavItem[] = [
  { labelKey: "home", label: "Home", href: "/dashboard", icon: House, module: "home" },
  salesGroup,
  ...plannedGroups,
  setupGroup,
];

type Can = (module: CrmModule, action?: CrmAction) => boolean;

/**
 * Items the user may view: leaves with a `module` need `can(module, 'view')`,
 * planned (`soon`) items are visible to everyone, groups without visible
 * children are dropped.
 */
export function filterNavigation(
  items: CrmNavItem[],
  can: Can,
  options: { isSuperAdmin?: boolean } = {}
): CrmNavItem[] {
  const out: CrmNavItem[] = [];
  for (const item of items) {
    if (item.superAdminOnly && !options.isSuperAdmin) continue;
    if (item.module && !can(item.module, "view")) continue;
    if (item.children) {
      const children = filterNavigation(item.children, can, options);
      if (!item.href && children.length === 0) continue;
      out.push({ ...item, children: children.length > 0 ? children : undefined });
      continue;
    }
    out.push(item);
  }
  return out;
}

/** Every item with an href, depth-first. */
export function flattenNavigation(items: CrmNavItem[]): CrmNavItem[] {
  const out: CrmNavItem[] = [];
  for (const item of items) {
    if (item.href) out.push(item);
    if (item.children) out.push(...flattenNavigation(item.children));
  }
  return out;
}

function matches(pathname: string, href?: string) {
  return Boolean(href) && (pathname === href || pathname.startsWith(`${href}/`));
}

/** The deepest nav item whose href is the pathname or a prefix of it. */
export function findActiveHref(pathname: string, items: CrmNavItem[] = crmNavigation) {
  let best: string | undefined;
  for (const item of flattenNavigation(items)) {
    if (matches(pathname, item.href) && (item.href?.length ?? 0) > (best?.length ?? 0)) {
      best = item.href;
    }
  }
  return best;
}

/** Sum of the badges of an item and its descendants. */
export function badgeTotal(item: CrmNavItem, counts: NavCounts): number {
  const own = item.badge ? (counts[item.badge] ?? 0) : 0;
  return own + (item.children ?? []).reduce((sum, child) => sum + badgeTotal(child, counts), 0);
}

export type Breadcrumb = { labelKey?: string; label: string; href?: string };

/** Home / group / item / (detail) breadcrumbs for the topbar. */
export function getBreadcrumbs(pathname: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ labelKey: "home", label: "Home", href: "/dashboard" }];
  if (pathname === "/dashboard") return crumbs;

  const activeHref = findActiveHref(pathname);
  if (!activeHref) return crumbs;

  const trail = (items: CrmNavItem[], path: CrmNavItem[]): CrmNavItem[] | null => {
    for (const item of items) {
      const next = [...path, item];
      if (item.href === activeHref) return next;
      if (item.children) {
        const found = trail(item.children, next);
        if (found) return found;
      }
    }
    return null;
  };

  const path = trail(crmNavigation, []) ?? [];
  path.forEach((item, index) => {
    const last = index === path.length - 1;
    crumbs.push({
      labelKey: item.labelKey,
      label: item.label,
      href: item.href && (!last || pathname !== item.href) ? item.href : undefined,
    });
  });
  if (pathname !== activeHref) crumbs.push({ labelKey: "detail", label: "Detail" });
  return crumbs;
}
