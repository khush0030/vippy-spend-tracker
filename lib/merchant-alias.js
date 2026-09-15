/**
 * Renaming a merchant everywhere at once, and remembering the rename so the
 * next sync applies it too. Shared by the dashboard route and the chat tool.
 */
export async function renameMerchant({ supabase, userId, from, to }) {
  const { data: rows, error } = await supabase
    .from("transactions")
    .update({ merchant: to })
    .eq("user_id", userId)
    .eq("merchant", from)
    .select("id");
  if (error) throw error;

  const { error: aliasError } = await supabase
    .from("merchant_aliases")
    .upsert({ user_id: userId, original_merchant: from, alias: to }, { onConflict: "user_id,original_merchant" });
  // 42P01 = table doesn't exist; tolerate so rename still works without the table.
  if (aliasError && aliasError.code !== "42P01") throw aliasError;

  return { updated: rows?.length || 0, aliasStored: !aliasError };
}
