/** Brand palette from src/styles/tokens.css; persisted as HEX for mailbox dots. */
export const EMAIL_ACCOUNT_COLORS = [
  "#004F7C", "#4DAF4E", "#909B03", "#EA5744", "#01203F",
  "#009CD4", "#75C566", "#DBE64C", "#F1F5F1",
] as const;

export function emailAccountColor(value: string): (typeof EMAIL_ACCOUNT_COLORS)[number] {
  return EMAIL_ACCOUNT_COLORS.find((color) => color === value.toUpperCase()) ?? EMAIL_ACCOUNT_COLORS[0];
}
