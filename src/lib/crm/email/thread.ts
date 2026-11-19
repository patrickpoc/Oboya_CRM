/** Read the ASCII message identifiers without interpreting the subject charset. */
export function mailThread(headers: Buffer | undefined): { inReplyTo?: string; references: string[] } {
  const raw = headers?.toString("latin1").replace(/\r?\n[ \t]+/g, " ") ?? "";
  const identifiers = (name: string) => {
    const value = raw.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "mi"))?.[1]?.trim() ?? "";
    return (value.match(/<[^<>\s]+>/g) ?? value.split(/\s+/)).filter((id) => id && id.length <= 320).slice(0, 50);
  };
  return { inReplyTo: identifiers("in-reply-to")[0], references: [...new Set(identifiers("references"))] };
}
