import React, { useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";

const initial = [
  {
    id: 1,
    title: "เงินเดือน",
    type: "income",
    category: "เงินเดือน",
    amount: 48000,
    date: "2026-10-01",
    note: "เงินเดือนประจำ",
  },
  {
    id: 2,
    title: "ค่าเช่าบ้าน",
    type: "expense",
    category: "บิลและสาธารณูปโภค",
    amount: 9500,
    date: "2026-10-02",
    note: "",
  },
  {
    id: 3,
    title: "ซื้อของเข้าบ้าน",
    type: "expense",
    category: "อาหาร",
    amount: 1380,
    date: "2026-10-04",
    note: "ซูเปอร์มาร์เก็ต",
  },
  {
    id: 4,
    title: "งานออกแบบเว็บไซต์",
    type: "income",
    category: "ฟรีแลนซ์",
    amount: 8500,
    date: "2026-10-05",
    note: "",
  },
  {
    id: 5,
    title: "ค่าเดินทาง",
    type: "expense",
    category: "เดินทาง",
    amount: 760,
    date: "2026-10-06",
    note: "",
  },
  {
    id: 6,
    title: "กาแฟและอาหารกลางวัน",
    type: "expense",
    category: "อาหาร",
    amount: 420,
    date: "2026-10-07",
    note: "",
  },
  {
    id: 7,
    title: "ค่าสมาชิกฟิตเนส",
    type: "expense",
    category: "สุขภาพ",
    amount: 1200,
    date: "2026-09-23",
    note: "",
  },
  {
    id: 8,
    title: "เงินปันผล",
    type: "income",
    category: "การลงทุน",
    amount: 2100,
    date: "2026-09-17",
    note: "",
  },
  {
    id: 9,
    title: "ตั๋วเครื่องบิน",
    type: "expense",
    category: "ท่องเที่ยว",
    amount: 4300,
    date: "2026-08-19",
    note: "",
  },
  {
    id: 10,
    title: "โปรเจกต์ออกแบบ",
    type: "income",
    category: "ฟรีแลนซ์",
    amount: 6200,
    date: "2026-08-12",
    note: "",
  },
  {
    id: 11,
    title: "ของใช้ส่วนตัว",
    type: "expense",
    category: "ช้อปปิ้ง",
    amount: 1750,
    date: "2026-07-21",
    note: "",
  },
  {
    id: 12,
    title: "เงินเดือน",
    type: "income",
    category: "เงินเดือน",
    amount: 48000,
    date: "2026-09-01",
    note: "",
  },
];
const categoriesDefault = {
  income: ["เงินเดือน", "ฟรีแลนซ์", "ธุรกิจ", "การลงทุน", "รายรับอื่นๆ"],
  expense: [
    "อาหาร",
    "เดินทาง",
    "ช้อปปิ้ง",
    "บิลและสาธารณูปโภค",
    "บันเทิง",
    "สุขภาพ",
    "การศึกษา",
    "ท่องเที่ยว",
    "อื่นๆ",
  ],
};
const icons = { balance: "◈", income: "↗", expense: "↘", savings: "✳" };
const money = (n) =>
  "฿" +
  Number(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const monthKey = (d) => d.slice(0, 7);
const compareNewest = (a, b) =>
  b.date.localeCompare(a.date) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
const compareOldest = (a, b) =>
  a.date.localeCompare(b.date) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
const chartScale = (rows) =>
  Math.max(10000, Math.ceil(Math.max(0, ...rows.flatMap((row) => [row.income, row.expense])) / 10000) * 10000);
const chartTicks = (scale) => [scale, scale * 0.8, scale * 0.6, scale * 0.4, scale * 0.2, 0];
const axisMoney = (value) => value >= 1000 ? `฿${Math.round(value / 1000)}k` : `฿${Math.round(value)}`;
const localDateInput = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
};
const monthStartInput = () => {
  const today = new Date();
  return localDateInput(new Date(today.getFullYear(), today.getMonth(), 1));
};
const monthLabel = (key) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString("th-TH", {
    month: "short",
  });
const monthChoices = (transactions) =>
  [...new Set([monthKey(localDateInput()), ...transactions.map((t) => monthKey(t.date))])]
    .sort()
    .reverse();
const seedTransactions = () => {
  const today = new Date();
  const monthOffset = today.getFullYear() * 12 + today.getMonth() - (2026 * 12 + 9);
  return initial.map((item) => {
    const date = new Date(`${item.date}T12:00:00`);
    date.setMonth(date.getMonth() + monthOffset);
    return { ...item, date: localDateInput(date) };
  });
};
const prettyDate = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function FinanceApp({ user, onSignOut }) {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState(categoriesDefault);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [notice, setNotice] = useState("");
  const [dark, setDark] = useState(
    () => localStorage.getItem("ledger.dark") === "true",
  );
  const [page, setPage] = useState("ภาพรวม"),
    [modal, setModal] = useState(false),
    [editing, setEditing] = useState(null),
    [formType, setFormType] = useState("expense"),
    [formCategory, setFormCategory] = useState(categoriesDefault.expense[0]),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState("ทั้งหมด"),
    [catFilter, setCatFilter] = useState("ทั้งหมด"),
    [sort, setSort] = useState("new"),
    [mobile, setMobile] = useState(false),
    [range, setRange] = useState("ทั้งหมด"),
    [dashboardRange, setDashboardRange] = useState("ทั้งหมด"),
    [reportStart, setReportStart] = useState(monthStartInput),
    [reportEnd, setReportEnd] = useState(localDateInput);
  async function loadAccountData() {
    setDataLoading(true);
    setDataError("");
    try {
      const [transactionResult, categoryResult] = await Promise.all([
        api.transactions(),
        api.categories(),
      ]);
      setTransactions(transactionResult.transactions || []);
      const grouped = { income: [], expense: [] };
      for (const row of categoryResult.categories || []) grouped[row.type].push(row.name);
      setCategories({
        income: grouped.income.length ? grouped.income : categoriesDefault.income,
        expense: grouped.expense.length ? grouped.expense : categoriesDefault.expense,
      });
    } catch (error) {
      setDataError(error.message);
    } finally {
      setDataLoading(false);
    }
  }
  useEffect(() => { loadAccountData(); }, [user.id]);
  const theme = dark ? "dark" : "";
  const now = monthKey(localDateInput());
  const currentMonthTitle = new Date(`${now}-01T00:00:00`).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  const monthItems = transactions.filter((t) => monthKey(t.date) === now);
  const sum = (arr, type) =>
    arr
      .filter((t) => t.type === type)
      .reduce((a, t) => a + Number(t.amount), 0);
  const allIncome = sum(transactions, "income"),
    allExpense = sum(transactions, "expense"),
    income = sum(monthItems, "income"),
    expense = sum(monthItems, "expense");
  const monthly = monthChoices(transactions).sort().slice(-12).map((key) => {
    const items = transactions.filter((t) => monthKey(t.date) === key);
    return { label: monthLabel(key), key, income: sum(items, "income"), expense: sum(items, "expense") };
  });
  const dashboardMonthly = dashboardRange === "ทั้งหมด"
    ? monthly.slice(-4)
    : monthly.filter((m) => m.key === dashboardRange);
  const dashboardScale = chartScale(dashboardMonthly);
  const reportItems = transactions.filter(
    (t) => t.date >= reportStart && t.date <= reportEnd,
  );
  const reportIncome = sum(reportItems, "income");
  const reportExpense = sum(reportItems, "expense");
  const reportCats = categories.expense
    .map((name) => ({
      name,
      value: sum(reportItems.filter((t) => t.category === name), "expense"),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const reportDonutStyle = {
    background: reportExpense
      ? `conic-gradient(${reportCats.map((c, i) => `${["#47b386", "#8e83d7", "#e8ae69", "#72a6d6", "#e68074"][i % 5]} ${reportCats.slice(0, i).reduce((n, x) => n + (x.value / reportExpense) * 100, 0)}% ${reportCats.slice(0, i + 1).reduce((n, x) => n + (x.value / reportExpense) * 100, 0)}%`).join(",")})`
      : "conic-gradient(#e9edf0 0% 100%)",
  };
  const reportMonthly = [...new Set(reportItems.map((t) => monthKey(t.date)))]
    .sort()
    .slice(-6)
    .map((key) => {
      const items = reportItems.filter((t) => monthKey(t.date) === key);
      return { key, label: monthLabel(key), income: sum(items, "income"), expense: sum(items, "expense") };
    });
  const reportScale = chartScale(reportMonthly);
  const cats = categories.expense
    .map((name) => ({
      name,
      value: sum(
        monthItems.filter((t) => t.category === name),
        "expense",
      ),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const donutStyle = {
    background: expense
      ? `conic-gradient(${cats.map((c, i) => `${["#47b386", "#8e83d7", "#e8ae69", "#72a6d6", "#e68074"][i % 5]} ${cats.slice(0, i).reduce((n, x) => n + (x.value / expense) * 100, 0)}% ${cats.slice(0, i + 1).reduce((n, x) => n + (x.value / expense) * 100, 0)}%`).join(",")})`
      : "conic-gradient(#e9edf0 0% 100%)",
  };
  const filtered = useMemo(
    () =>
      transactions
        .filter((t) => {
          const q = query.toLowerCase();
          return (
            (!q ||
              `${t.title} ${t.category} ${t.note}`.toLowerCase().includes(q)) &&
            (kind === "ทั้งหมด" ||
              t.type === (kind === "รายรับ" ? "income" : "expense")) &&
            (catFilter === "ทั้งหมด" || t.category === catFilter) &&
            (range === "ทั้งหมด" || monthKey(t.date) === range)
          );
        })
        .sort(sort === "new" ? compareNewest : compareOldest),
    [transactions, query, kind, catFilter, sort, range],
  );
  const nav = [
    ["ภาพรวม", "▦"],
    ["รายการธุรกรรม", "⇄"],
    ["รายงาน", "▥"],
    ["หมวดหมู่", "◫"],
    ["ตั้งค่า", "⚙"],
  ];
  const openAdd = () => {
    setEditing(null);
    setFormType("expense");
    setFormCategory(categories.expense[0] || categoriesDefault.expense[0]);
    setModal(true);
  };
  const edit = (t) => {
    setEditing(t);
    setFormType(t.type);
    setFormCategory(t.category);
    setModal(true);
  };
  async function addCategory(type, name) {
    try {
      const { category } = await api.addCategory({ type, name });
      setCategories((current) => ({ ...current, [type]: [...current[type], category.name] }));
      setDataError("");
      return true;
    } catch (error) { setDataError(error.message); return false; }
  }
  async function removeCategory(type, name) {
    try {
      await api.deleteCategory({ type, name });
      setCategories((current) => ({ ...current, [type]: current[type].filter((item) => item !== name) }));
      setDataError("");
    } catch (error) { setDataError(error.message); }
  }
  async function importLegacyData() {
    try {
      const oldTransactions = JSON.parse(localStorage.getItem("ledger.transactions") || "[]");
      if (!Array.isArray(oldTransactions) || !oldTransactions.length) {
        setNotice("ไม่พบรายการเก่าที่บันทึกไว้ในเบราว์เซอร์นี้");
        return;
      }
      if (transactions.length) {
        setNotice("นำเข้าข้อมูลเก่าได้เมื่อบัญชีนี้ยังไม่มีรายการเท่านั้น");
        return;
      }
      if (!confirm(`นำเข้า ${oldTransactions.length} รายการจากข้อมูลเดิมในเบราว์เซอร์นี้หรือไม่?`)) return;
      const oldCategories = JSON.parse(localStorage.getItem("ledger.categories") || "null");
      if (oldCategories) {
        for (const type of ["income", "expense"]) {
          for (const name of oldCategories[type] || []) {
            if (!categories[type].includes(name)) {
              await api.addCategory({ type, name });
              setCategories((current) => ({ ...current, [type]: [...current[type], name] }));
            }
          }
        }
      }
      const result = await api.importTransactions(oldTransactions);
      localStorage.removeItem("ledger.transactions");
      localStorage.removeItem("ledger.categories");
      await loadAccountData();
      setNotice(`นำเข้าข้อมูล ${result.imported} รายการแล้ว`);
    } catch (error) { setDataError(error.message); }
  }
  const del = async (id) => {
    if (!confirm("ลบรายการนี้ใช่ไหม?")) return;
    try {
      await api.deleteTransaction(id);
      setTransactions((items) => items.filter((t) => t.id !== id));
    } catch (error) { setDataError(error.message); }
  };
  async function save(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const row = {
      id: editing?.id || Date.now(),
      type: f.get("type"),
      title: f.get("title").trim(),
      amount: Number(f.get("amount")),
      category: f.get("category"),
      date: f.get("date"),
      note: f.get("note").trim(),
    };
    try {
      const result = editing
        ? await api.updateTransaction(editing.id, row)
        : await api.addTransaction(row);
      if (editing) setTransactions((items) => items.map((t) => t.id === editing.id ? result.transaction : t));
      else setTransactions((items) => [result.transaction, ...items]);
      setModal(false);
      setDataError("");
    } catch (error) { setDataError(error.message); }
  }
  function toggleTheme() {
    const v = !dark;
    setDark(v);
    localStorage.setItem("ledger.dark", String(v));
  }
  function exportData() {
    const backup = { exportedAt: new Date().toISOString(), transactions, categories };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finance-backup-${localDateInput()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (dataLoading) return <div className="auth-page"><div className="auth-card">กำลังโหลดข้อมูลบัญชี...</div></div>;
  const title = page === "ภาพรวม" ? "ภาพรวมการเงิน" : page;
  return (
    <div className={theme}>
      <div className="app-shell">
        <aside className={`sidebar ${mobile ? "show" : ""}`}>
          <div className="brand">
            <div className="brand-mark">฿</div>
            <span>
              เงินดี<span className="brand-dot">.</span>
            </span>
            <button className="close-nav" onClick={() => setMobile(false)}>
              ×
            </button>
          </div>
          <div className="workspace">
            <div className="avatar">ม</div>
            <div>
              <b>บัญชีส่วนตัว</b>
              <small>Personal workspace</small>
            </div>
            <span className="chevron">⌄</span>
          </div>
          <div className="nav-label">เมนูหลัก</div>
          <nav>
            {nav.map(([n, ic]) => (
              <button
                key={n}
                onClick={() => {
                  setPage(n);
                  setMobile(false);
                }}
                className={`nav-item ${page === n ? "active" : ""}`}
              >
                <span className="nav-icon">{ic}</span>
                {n}
                {n === "รายการธุรกรรม" && (
                  <span className="nav-count">{transactions.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="tip-card">
              <div className="tip-icon">✦</div>
              <b>เก็บออมอย่างมีเป้าหมาย</b>
              <p>ทุกก้าวเล็กๆ ช่วยให้คุณไปถึงเป้าหมายได้เร็วขึ้น</p>
              <button onClick={() => setPage("รายงาน")}>
                ดูรายงาน <span>→</span>
              </button>
            </div>
            <div className="profile">
              <div className="profile-avatar">K</div>
              <div>
                <b>{user.email}</b>
                <small>บัญชีส่วนตัว</small>
              </div>
              <button onClick={toggleTheme} title="สลับธีม">
                {dark ? "☀" : "☾"}
              </button>
              <button onClick={onSignOut} title="ออกจากระบบ">↪</button>
            </div>
          </div>
        </aside>
        {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
        <main className="main-area">
          <header className="topbar">
            <button className="hamburger" onClick={() => setMobile(true)}>
              ☰
            </button>
            <div className="breadcrumbs">
              Workspace <span>/</span> <b>{page}</b>
            </div>
            <div className="top-actions">
              <span className="today">{new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
              <button
                className="icon-button theme-toggle"
                onClick={toggleTheme}
              >
                {dark ? "☀" : "☾"}
              </button>
              <div className="top-avatar">ก</div>
            </div>
          </header>
          <div className="content">
            {dataError && <div className="app-alert error-alert"><span>{dataError}</span><button onClick={loadAccountData}>ลองอีกครั้ง</button></div>}
            {notice && <div className="app-alert"><span>{notice}</span><button onClick={() => setNotice("")}>ปิด</button></div>}
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  ยินดีต้อนรับกลับมา, กานต์ <span>✦</span>
                </div>
                <h1>{title}</h1>
                <p>
                  {page === "ภาพรวม"
                    ? "สรุปสุขภาพการเงินของคุณในที่เดียว"
                    : "จัดการและติดตามการเงินของคุณได้ง่ายขึ้น"}
                </p>
              </div>
              <button className="primary-btn" onClick={openAdd}>
                <span>＋</span> เพิ่มรายการ
              </button>
            </div>
            {page === "ภาพรวม" && (
              <>
                <section className="summary-grid">
                  {[
                    [
                      "balance",
                      "ยอดคงเหลือ",
                      allIncome - allExpense,
                      "ยอดรวมทั้งหมด",
                    ],
                    ["income", "รายรับเดือนนี้", income, currentMonthTitle],
                    ["expense", "รายจ่ายเดือนนี้", expense, currentMonthTitle],
                    [
                      "savings",
                      "เงินออมเดือนนี้",
                      income - expense,
                      income
                        ? `${Math.round(((income - expense) / income) * 100)}% ของรายรับ`
                        : "เริ่มบันทึกรายรับ",
                    ],
                  ].map(([key, label, val, sub]) => (
                    <article className="summary-card" key={key}>
                      <div className="card-top">
                        <span>{label}</span>
                        <span className={`metric-icon ${key}`}>
                          {icons[key]}
                        </span>
                      </div>
                      <div className="metric-value">{money(val)}</div>
                      <div className="card-foot">
                        <span className={`metric-dot ${key}`}></span>
                        {sub}
                      </div>
                    </article>
                  ))}
                </section>
                <section className="chart-grid">
                  <article className="panel income-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>รายรับและรายจ่าย</h2>
                        <p>เปรียบเทียบกระแสเงินสดรายเดือน</p>
                      </div>
                      <select
                        value={dashboardRange}
                        onChange={(e) => setDashboardRange(e.target.value)}
                      >
                        <option value="ทั้งหมด">4 เดือนล่าสุด</option>
                        {monthChoices(transactions).slice(0, 12).map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00`).toLocaleDateString("th-TH", { month: "long", year: "numeric" })}</option>)}
                      </select>
                    </div>
                    <div className="legend">
                      <span>
                        <i className="legend-dot green"></i>รายรับ
                      </span>
                      <span>
                        <i className="legend-dot purple"></i>รายจ่าย
                      </span>
                    </div>
                    <div className="bar-chart">
                      <div className="axis-labels">
                        {chartTicks(dashboardScale).map((tick) => <span key={tick}>{axisMoney(tick)}</span>)}
                      </div>
                      <div className="chart-body">
                        <div className="grid-lines">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="bars">
                          {dashboardMonthly.map((m) => (
                            <div className="bar-group" key={m.label}>
                              <div className="bar-pair">
                                <div
                                  className="bar income-bar"
                                  style={{
                                    height: `${Math.max((m.income / dashboardScale) * 100, 2)}%`,
                                  }}
                                  title={money(m.income)}
                                ></div>
                                <div
                                  className="bar expense-bar"
                                  style={{
                                    height: `${Math.max((m.expense / dashboardScale) * 100, 2)}%`,
                                  }}
                                  title={money(m.expense)}
                                ></div>
                              </div>
                              <span>{m.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="chart-total">
                      <span>คงเหลือเดือนนี้</span>
                      <b>{money(income - expense)}</b>
                      <span className="positive">↑ ยอดเงินออมสุทธิ</span>
                    </div>
                  </article>
                  <article className="panel category-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>รายจ่ายตามหมวดหมู่</h2>
                        <p>ภาพรวมค่าใช้จ่ายเดือนนี้</p>
                      </div>
                      <button
                        className="more-btn"
                        onClick={() => setPage("รายงาน")}
                      >
                        •••
                      </button>
                    </div>
                    <div className="donut-wrap">
                      <div className="donut" style={donutStyle}>
                        <div>
                          <b>{money(expense)}</b>
                          <span>รายจ่ายรวม</span>
                        </div>
                      </div>
                    </div>
                    <div className="category-legend">
                      {cats.length ? (
                        cats.slice(0, 4).map((c, i) => (
                          <div className="category-row" key={c.name}>
                            <span className="cat-name">
                              <i className={"swatch s" + i}></i>
                              {c.name}
                            </span>
                            <b>{money(c.value)}</b>
                            <small>
                              {expense
                                ? Math.round((c.value / expense) * 100)
                                : 0}
                              %
                            </small>
                          </div>
                        ))
                      ) : (
                        <div className="empty-small">
                          ยังไม่มีรายจ่ายในเดือนนี้
                        </div>
                      )}
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setPage("รายงาน")}
                    >
                      ดูรายละเอียดรายจ่าย <span>→</span>
                    </button>
                  </article>
                </section>
                <section className="bottom-grid">
                  <article className="panel transactions-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>รายการล่าสุด</h2>
                        <p>ธุรกรรมที่บันทึกล่าสุดของคุณ</p>
                      </div>
                      <button
                        className="text-link"
                        onClick={() => setPage("รายการธุรกรรม")}
                      >
                        ดูทั้งหมด <span>→</span>
                      </button>
                    </div>
                    <TransactionList
                      list={transactions
                        .slice()
                        .sort(compareNewest)
                        .slice(0, 5)}
                      edit={edit}
                      del={del}
                    />
                  </article>
                  <article className="panel month-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>สรุปประจำเดือน</h2>
                        <p>{currentMonthTitle}</p>
                      </div>
                      <span className="calendar-icon">▦</span>
                    </div>
                    <div className="month-stat">
                      <span>รายรับทั้งหมด</span>
                      <b className="income-text">+{money(income)}</b>
                    </div>
                    <div className="month-stat">
                      <span>รายจ่ายทั้งหมด</span>
                      <b className="expense-text">−{money(expense)}</b>
                    </div>
                    <div className="progress-label">
                      <span>อัตราการออม</span>
                      <b>
                        {income
                          ? Math.max(
                              0,
                              Math.round(((income - expense) / income) * 100),
                            )
                          : 0}
                        %
                      </b>
                    </div>
                    <div className="progress">
                      <span
                        style={{
                          width: `${income ? Math.max(0, Math.min(((income - expense) / income) * 100, 100)) : 0}%`,
                        }}
                      />
                    </div>
                    <div className="saving-note">
                      <span>✦</span>
                      <p>
                        คุณใช้จ่ายไป{" "}
                        <b>
                          {income ? Math.round((expense / income) * 100) : 0}%
                        </b>{" "}
                        ของรายรับเดือนนี้
                      </p>
                    </div>
                  </article>
                </section>
              </>
            )}
            {page === "รายการธุรกรรม" && (
              <section className="panel full-panel">
                <div className="filters">
                  <label className="search">
                    <span>⌕</span>
                    <input
                      placeholder="ค้นหารายการ..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option>ทั้งหมด</option>
                    <option>รายรับ</option>
                    <option>รายจ่าย</option>
                  </select>
                  <select
                    value={catFilter}
                    onChange={(e) => setCatFilter(e.target.value)}
                  >
                    <option>ทั้งหมด</option>
                    {[...categories.income, ...categories.expense].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                  >
                    <option value="ทั้งหมด">ทุกช่วงเวลา</option>
                    {[...new Set(transactions.map((t) => monthKey(t.date)))]
                      .sort()
                      .reverse()
                      .map((m) => (
                        <option key={m} value={m}>
                          {new Date(m + "-01").toLocaleDateString("th-TH", {
                            month: "long",
                            year: "numeric",
                          })}
                        </option>
                      ))}
                  </select>
                  <button
                    className="sort-btn"
                    onClick={() => setSort(sort === "new" ? "old" : "new")}
                  >
                    ↕ {sort === "new" ? "ใหม่สุด" : "เก่าสุด"}
                  </button>
                </div>
                <TransactionList list={filtered} edit={edit} del={del} />
                {filtered.length === 0 && (
                  <div className="empty-state">
                    <span>◌</span>
                    <b>ไม่พบรายการ</b>
                    <p>ลองเปลี่ยนคำค้นหาหรือตัวกรอง</p>
                  </div>
                )}
              </section>
            )}
            {page === "รายงาน" && (
              <>
                <section className="summary-grid report-summary">
                  {[
                    ["รายรับในช่วงที่เลือก", reportIncome, "income"],
                    ["รายจ่ายในช่วงที่เลือก", reportExpense, "expense"],
                    ["เงินออมสุทธิ", reportIncome - reportExpense, "balance"],
                    ["จำนวนรายการ", reportItems.length, "savings"],
                  ].map(([l, v, k]) => (
                    <article className="summary-card" key={l}>
                      <div className="card-top">
                        <span>{l}</span>
                        <span className={`metric-icon ${k}`}>{icons[k]}</span>
                      </div>
                      <div className="metric-value">
                        {k === "savings" ? v + " รายการ" : money(v)}
                      </div>
                      <div className="card-foot">{reportStart} ถึง {reportEnd}</div>
                    </article>
                  ))}
                </section>
                <section className="chart-grid">
                  <article className="panel income-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>แนวโน้มรายรับและรายจ่าย</h2>
                        <p>สรุปตามช่วงวันที่ที่เลือก</p>
                      </div>
                      <div className="report-date-filters">
                        <input aria-label="วันที่เริ่มต้นรายงาน" type="date" max={reportEnd} value={reportStart} onChange={(e) => setReportStart(e.target.value)} />
                        <span>ถึง</span>
                        <input aria-label="วันที่สิ้นสุดรายงาน" type="date" min={reportStart} value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} />
                      </div>
                    </div>
                    <div className="legend">
                      <span>
                        <i className="legend-dot green"></i>รายรับ
                      </span>
                      <span>
                        <i className="legend-dot purple"></i>รายจ่าย
                      </span>
                    </div>
                    <div className="bar-chart report-bars">
                      <div className="axis-labels">
                        {chartTicks(reportScale).map((tick) => <span key={tick}>{axisMoney(tick)}</span>)}
                      </div>
                      <div className="chart-body">
                        <div className="grid-lines">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="bars">
                          {reportMonthly.map((m) => (
                            <div className="bar-group" key={m.key}>
                              <div className="bar-pair">
                                <div
                                  className="bar income-bar"
                                  style={{
                                    height: `${Math.max((m.income / reportScale) * 100, 2)}%`,
                                  }}
                                ></div>
                                <div
                                  className="bar expense-bar"
                                  style={{
                                    height: `${Math.max((m.expense / reportScale) * 100, 2)}%`,
                                  }}
                                ></div>
                              </div>
                              <span>{m.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                  <article className="panel category-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>สัดส่วนรายจ่าย</h2>
                        <p>{reportStart} ถึง {reportEnd}</p>
                      </div>
                    </div>
                    <div className="donut-wrap">
                      <div className="donut" style={reportDonutStyle}>
                        <div>
                          <b>{money(reportExpense)}</b>
                          <span>รายจ่ายรวม</span>
                        </div>
                      </div>
                    </div>
                    <div className="category-legend">
                      {reportCats.map((c, i) => (
                        <div className="category-row" key={c.name}>
                          <span className="cat-name">
                            <i className={"swatch s" + (i % 5)}></i>
                            {c.name}
                          </span>
                          <b>{money(c.value)}</b>
                          <small>
                            {reportExpense
                              ? Math.round((c.value / reportExpense) * 100)
                              : 0}
                            %
                          </small>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              </>
            )}
            {page === "หมวดหมู่" && (
              <section className="category-management">
                <CategoryGroup
                  title="หมวดหมู่รายรับ"
                  type="income"
                  categories={categories}
                  onAdd={addCategory}
                  onRemove={removeCategory}
                />
                <CategoryGroup
                  title="หมวดหมู่รายจ่าย"
                  type="expense"
                  categories={categories}
                  onAdd={addCategory}
                  onRemove={removeCategory}
                />
              </section>
            )}
            {page === "ตั้งค่า" && (
              <section className="panel settings-panel">
                <h2>การตั้งค่า</h2>
                <div className="setting-row">
                  <div>
                    <b>ธีมการแสดงผล</b>
                    <p>เลือกธีมสว่างหรือธีมมืด</p>
                  </div>
                  <button className="secondary-btn" onClick={toggleTheme}>
                    {dark ? "☀ ใช้ธีมสว่าง" : "☾ ใช้ธีมมืด"}
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <b>สกุลเงิน</b>
                    <p>สกุลเงินหลักที่ใช้แสดงในแอป</p>
                  </div>
                  <span className="currency-pill">฿ THB · บาทไทย</span>
                </div>
                <div className="setting-row">
                  <div>
                    <b>ข้อมูลของคุณ</b>
                    <p>ข้อมูลจัดเก็บในฐานข้อมูล SQLite ของเซิร์ฟเวอร์</p>
                  </div>
                  <span className="secure-label">● บันทึกอัตโนมัติ</span>
                </div>
                <div className="setting-row">
                  <div>
                    <b>สำรองข้อมูล</b>
                    <p>ดาวน์โหลดรายการและหมวดหมู่เป็นไฟล์ JSON เก็บไว้</p>
                  </div>
                  <button type="button" className="secondary-btn" onClick={exportData}>ดาวน์โหลดข้อมูล</button>
                </div>
                <div className="setting-row">
                  <div>
                    <b>ย้ายข้อมูลจากอุปกรณ์นี้</b>
                    <p>นำเข้ารายการที่บันทึกไว้ก่อนสมัครบัญชี</p>
                  </div>
                  <button type="button" className="secondary-btn" onClick={importLegacyData}>นำเข้าข้อมูลเดิม</button>
                </div>
              </section>
            )}
            <footer className="footer">
              <span>© 2026 เงินดี · จัดการการเงินได้อย่างมั่นใจ</span>
              <span>ข้อมูลของคุณจัดเก็บอย่างปลอดภัยในอุปกรณ์นี้</span>
            </footer>
          </div>
        </main>
        {modal && (
          <div
            className="modal-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setModal(false)}
          >
            <form className="transaction-modal" onSubmit={save}>
              <div className="modal-heading">
                <div>
                  <span className="modal-kicker">บันทึกการเงิน</span>
                  <h2>{editing ? "แก้ไขรายการ" : "เพิ่มรายการใหม่"}</h2>
                  <p>กรอกรายละเอียดธุรกรรมของคุณ</p>
                </div>
                <button
                  type="button"
                  className="close-modal"
                  onClick={() => setModal(false)}
                >
                  ×
                </button>
              </div>
              <label className="field-label">ประเภทธุรกรรม</label>
              <div className="type-selector">
                <label className={formType === "expense" ? "selected expense-select" : ""}>
                  <input
                    type="radio"
                    name="type"
                    value="expense"
                    checked={formType === "expense"}
                    onChange={() => { setFormType("expense"); setFormCategory(categories.expense[0] || categoriesDefault.expense[0]); }}
                  />{" "}
                  ↘ รายจ่าย
                </label>
                <label className={formType === "income" ? "selected income-select" : ""}>
                  <input
                    type="radio"
                    name="type"
                    value="income"
                    checked={formType === "income"}
                    onChange={() => { setFormType("income"); setFormCategory(categories.income[0] || categoriesDefault.income[0]); }}
                  />{" "}
                  ↗ รายรับ
                </label>
              </div>
              <label className="field-label">ชื่อรายการ</label>
              <input
                className="form-input"
                name="title"
                required
                placeholder="เช่น ค่าอาหารกลางวัน"
                defaultValue={editing?.title}
              />
              <div className="form-grid">
                <div>
                  <label className="field-label">จำนวนเงิน (บาท)</label>
                  <input
                    className="form-input"
                    name="amount"
                    required
                    min="0.01"
                    step="0.01"
                    type="number"
                    placeholder="0.00"
                    defaultValue={editing?.amount}
                  />
                </div>
                <div>
                  <label className="field-label">หมวดหมู่</label>
                  <select
                    className="form-input"
                    name="category"
                    required
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                  >
                    {(categories[formType] || []).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                    {editing?.category && !(categories[formType] || []).includes(editing.category) && <option>{editing.category}</option>}
                  </select>
                </div>
              </div>
              <label className="field-label">วันที่</label>
              <input
                className="form-input"
                name="date"
                required
                type="date"
                defaultValue={editing?.date || localDateInput()}
              />
              <label className="field-label">
                บันทึกเพิ่มเติม <span className="optional">ไม่บังคับ</span>
              </label>
              <textarea
                className="form-input note-input"
                name="note"
                placeholder="เพิ่มรายละเอียด..."
                defaultValue={editing?.note}
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setModal(false)}
                >
                  ยกเลิก
                </button>
                <button className="primary-btn" type="submit">
                  {editing ? "บันทึกการแก้ไข" : "บันทึกรายการ"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionList({ list, edit, del }) {
  return (
    <div className="table-wrap">
      <table className="transaction-table">
        <thead>
          <tr>
            <th>รายการ</th>
            <th>หมวดหมู่</th>
            <th>วันที่</th>
            <th>จำนวนเงิน</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.id}>
              <td>
                <div className="transaction-name">
                  <span className={`transaction-symbol ${t.type}`}>
                    {t.type === "income" ? "↗" : "↘"}
                  </span>
                  <div>
                    <b>{t.title}</b>
                    <small>
                      {t.note || (t.type === "income" ? "รายรับ" : "รายจ่าย")}
                    </small>
                  </div>
                </div>
              </td>
              <td>
                <span className="category-badge">{t.category}</span>
              </td>
              <td className="date-cell">{prettyDate(t.date)}</td>
              <td className={`amount-cell ${t.type}`}>
                {t.type === "income" ? "+" : "−"}
                {money(t.amount)}
              </td>
              <td>
                <div className="row-actions">
                  <button onClick={() => edit(t)} title="แก้ไข">
                    ✎
                  </button>
                  <button onClick={() => del(t.id)} title="ลบ">
                    ⌫
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CategoryGroup({ title, type, categories, onAdd, onRemove }) {
  const [value, setValue] = useState("");
  async function add() {
    const v = value.trim();
    if (!v || categories[type].includes(v)) return;
    if (await onAdd(type, v)) setValue("");
  }
  function remove(v) {
    if (!confirm(`ลบหมวดหมู่ “${v}” หรือไม่?`)) return;
    onRemove(type, v);
  }
  return (
    <article className="panel category-group">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>เพิ่มหรือจัดการหมวดหมู่ของคุณ</p>
        </div>
        <span className={`metric-icon ${type}`}>
          {type === "income" ? "↗" : "↘"}
        </span>
      </div>
      <div className="category-chips">
        {categories[type].map((c) => (
          <span className="manage-chip" key={c}>
            {c}
            <button onClick={() => remove(c)}>×</button>
          </span>
        ))}
      </div>
      <div className="add-category">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="ชื่อหมวดหมู่ใหม่"
        />
        <button className="secondary-btn" onClick={add}>
          ＋ เพิ่มหมวดหมู่
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    let active = true;
    api.session()
      .then(({ user: currentUser }) => { if (active) setUser(currentUser); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    await api.signOut().catch(() => {});
    setUser(null);
  }
  if (checkingSession) return <div className="auth-page"><div className="auth-card">กำลังตรวจสอบบัญชี...</div></div>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;
  return <FinanceApp key={user.id} user={user} onSignOut={signOut} />;
}

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = mode === "signup"
        ? await api.signUp({ email, password, categories: categoriesDefault })
        : await api.signIn({ email, password });
      onAuthenticated(response.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand auth-brand"><div className="brand-mark">฿</div><span>เงินดี<span className="brand-dot">.</span></span></div>
        <div className="auth-kicker">บัญชีการเงินส่วนตัว</div>
        <h1>{mode === "signup" ? "สร้างบัญชีใหม่" : "ยินดีต้อนรับกลับ"}</h1>
        <p className="auth-description">{mode === "signup" ? "สมัครเพื่อบันทึกและเรียกดูข้อมูลของคุณได้ทุกครั้งที่เข้าสู่ระบบ" : "เข้าสู่ระบบเพื่อดูข้อมูลการเงินของคุณ"}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <label htmlFor="auth-email">อีเมล</label>
        <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        <label htmlFor="auth-password">รหัสผ่าน</label>
        <input id="auth-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8–128 ตัวอักษร" />
        <button className="primary-btn auth-submit" disabled={busy}>{busy ? "กำลังดำเนินการ..." : mode === "signup" ? "สร้างบัญชี" : "เข้าสู่ระบบ"}</button>
        <div className="auth-switch">{mode === "signup" ? "มีบัญชีแล้ว?" : "ยังไม่มีบัญชี?"}<button type="button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}>{mode === "signup" ? "เข้าสู่ระบบ" : "สมัครบัญชี"}</button></div>
        <div className="auth-local-note">โหมด localhost: อีเมลใช้เป็นชื่อบัญชี ยังไม่มีการส่งอีเมลยืนยัน</div>
      </form>
    </div>
  );
}
