async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "ติดต่อระบบไม่สำเร็จ");
  return data;
}

const json = (body) => ({ method: "POST", body: JSON.stringify(body) });
export const api = {
  session: () => request("/auth/session"),
  signUp: (body) => request("/auth/signup", json(body)),
  signIn: (body) => request("/auth/login", json(body)),
  signOut: () => request("/auth/logout", json({})),
  transactions: () => request("/transactions"),
  addTransaction: (body) => request("/transactions", json(body)),
  updateTransaction: (id, body) => request(`/transactions/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTransaction: (id) => request(`/transactions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importTransactions: (transactions) => request("/transactions/import", json({ transactions })),
  categories: () => request("/categories"),
  addCategory: (body) => request("/categories", json(body)),
  deleteCategory: (body) => request("/categories", { method: "DELETE", body: JSON.stringify(body) }),
};
