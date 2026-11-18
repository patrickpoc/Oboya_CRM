import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Bot,
  ChartColumn,
  Copy,
  FileSpreadsheet,
  FileText,
  LifeBuoy,
  Mail,
  Megaphone,
  Newspaper,
  Package,
  Plug,
  ShoppingCart,
  TrendingUp,
  Workflow,
} from "lucide-react";
import type { CrmModule } from "@/lib/crm/types";

export const ROADMAP_GROUPS = ["sales", "service", "marketing", "insights", "platform"] as const;
export type RoadmapGroup = (typeof ROADMAP_GROUPS)[number];

export type RoadmapStatus = "planned" | "live";

export type RoadmapModule = {
  id: string;
  group: RoadmapGroup;
  icon: LucideIcon;
  href: string;
  status: RoadmapStatus;
  /** Permission module for live entries; planned entries omit it. */
  module?: CrmModule;
  /** Keys under `roadmap.modules.<id>.capabilities` */
  capabilityKeys: string[];
  /**
   * Keys under `roadmap.modules.<id>.dependencies`. A key that is another
   * roadmap id links to that module; any other key is labelled from
   * `roadmap.external.<key>`.
   */
  dependencyKeys: string[];
};

/**
 * Planned modules shown as "To be done" pages. To promote one: replace its
 * route page with the real module and set `status: "live"`.
 */
export const roadmap: RoadmapModule[] = [
  {
    id: "products",
    group: "sales",
    icon: Package,
    href: "/products",
    status: "planned",
    capabilityKeys: ["catalogSync", "priceBooks", "lineItems", "multiCurrency", "activeFlag"],
    dependencyKeys: ["websiteCatalogApi", "opportunityLineItems"],
  },
  {
    id: "quotes",
    group: "sales",
    icon: FileText,
    href: "/quotes",
    status: "planned",
    capabilityKeys: ["fromOpportunity", "pricing", "pdf", "approvalThreshold", "rfqLink", "versions"],
    dependencyKeys: ["products", "approvals"],
  },
  {
    id: "orders",
    group: "sales",
    icon: ShoppingCart,
    href: "/orders",
    status: "planned",
    capabilityKeys: ["fromClosedWon", "fromQuote", "fulfilment", "erpHandoff", "accountHistory"],
    dependencyKeys: ["quotes", "erpIntegration"],
  },
  {
    id: "campaigns",
    group: "marketing",
    icon: Megaphone,
    href: "/campaigns",
    status: "planned",
    capabilityKeys: ["types", "members", "attribution", "costRoi", "hierarchy"],
    dependencyKeys: ["campaignIdColumns"],
  },
  {
    id: "email",
    group: "marketing",
    icon: Mail,
    href: "/email",
    status: "live",
    module: "email",
    capabilityKeys: [
      "mailboxSync",
      "templates",
      "sendFromRecord",
      "autoLogging",
      "replyDetection",
      "localCache",
      "integrations",
    ],
    dependencyKeys: ["integrations"],
  },
  {
    id: "reports",
    group: "insights",
    icon: ChartColumn,
    href: "/reports",
    status: "planned",
    capabilityKeys: ["builder", "grouping", "charts", "sharing", "dashboards", "export"],
    dependencyKeys: [],
  },
  {
    id: "industry-news",
    group: "insights",
    icon: Newspaper,
    href: "/industry-news",
    status: "live",
    module: "industry_news",
    capabilityKeys: ["sources", "keywords", "regions", "ranking", "freshness"],
    dependencyKeys: [],
  },
  {
    id: "forecasting",
    group: "insights",
    icon: TrendingUp,
    href: "/forecasting",
    status: "planned",
    capabilityKeys: ["hierarchy", "quotas", "weighted", "categories", "currencyRollup"],
    dependencyKeys: ["reports", "fxRates"],
  },
  {
    id: "cases",
    group: "service",
    icon: LifeBuoy,
    href: "/cases",
    status: "live",
    module: "cases",
    capabilityKeys: ["tickets", "priority", "sla", "emailToCase", "resolution", "reporting"],
    dependencyKeys: ["email"],
  },
  {
    id: "automation",
    group: "platform",
    icon: Workflow,
    href: "/automation",
    status: "planned",
    capabilityKeys: ["assignmentRules", "stageTasks", "alerts", "slaEscalation", "auditTrail"],
    dependencyKeys: [],
  },
  {
    id: "approvals",
    group: "platform",
    icon: BadgeCheck,
    href: "/approvals",
    status: "planned",
    capabilityKeys: ["policies", "approvers", "statuses", "inbox", "history"],
    dependencyKeys: ["quotes"],
  },
  {
    id: "ai-assistant",
    group: "insights",
    icon: Bot,
    href: "/ai-assistant",
    status: "planned",
    capabilityKeys: ["leadScoring", "summaries", "nextBestAction", "emailDrafts", "guardrails"],
    dependencyKeys: ["email", "reports"],
  },
  {
    id: "integrations",
    group: "platform",
    icon: Plug,
    href: "/integrations",
    status: "planned",
    capabilityKeys: ["websiteForms", "erp", "whatsapp", "calendar", "health"],
    dependencyKeys: [],
  },
  {
    id: "data-import",
    group: "platform",
    icon: FileSpreadsheet,
    href: "/data-import",
    status: "planned",
    capabilityKeys: ["wizard", "mapping", "preview", "dedupe", "importLog"],
    dependencyKeys: ["duplicates"],
  },
  {
    id: "duplicates",
    group: "platform",
    icon: Copy,
    href: "/duplicates",
    status: "planned",
    capabilityKeys: ["matchingRules", "alertsOnCreate", "merge", "mergeAudit"],
    dependencyKeys: [],
  },
];

export type RoadmapId = (typeof roadmap)[number]["id"];

export function getRoadmapModule(id: string): RoadmapModule | undefined {
  return roadmap.find((entry) => entry.id === id);
}

export function isRoadmapId(key: string): boolean {
  return roadmap.some((entry) => entry.id === key);
}
