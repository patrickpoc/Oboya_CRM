/** Brand palette from src/styles/tokens.css; persisted as HEX for mailbox dots. */
export const EMAIL_ACCOUNT_COLORS = [
  "#004F7C", "#4DAF4E", "#909B03", "#EA5744", "#01203F",
  "#009CD4", "#75C566", "#DBE64C", "#F1F5F1",
] as const;

export function emailAccountColor(value: string): (typeof EMAIL_ACCOUNT_COLORS)[number] {
  return EMAIL_ACCOUNT_COLORS.find((color) => color === value.toUpperCase()) ?? EMAIL_ACCOUNT_COLORS[0];
}

/** i18n key suffix (email.account.colors.*) for each brand colour, so pickers can name them. */
export const EMAIL_ACCOUNT_COLOR_NAMES: Record<(typeof EMAIL_ACCOUNT_COLORS)[number], string> = {
  "#004F7C": "blue",
  "#4DAF4E": "green",
  "#909B03": "olive",
  "#EA5744": "orange",
  "#01203F": "navy",
  "#009CD4": "lightBlue",
  "#75C566": "lightGreen",
  "#DBE64C": "yellow",
  "#F1F5F1": "softWhite",
};
